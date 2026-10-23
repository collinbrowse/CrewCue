import Foundation

public struct StoredOperation: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var type: String
    public var status: String
    public var conflictKey: String
    public var roomId: String
    public var payloadJSON: String
    public var idempotencyKey: String
    public var clientMessageId: String
    public var recordedAt: String?
    public var role: String

    public init(
        id: String,
        type: String,
        status: String = "pending",
        conflictKey: String,
        roomId: String,
        payloadJSON: String,
        idempotencyKey: String,
        clientMessageId: String,
        recordedAt: String? = nil,
        role: String
    ) {
        self.id = id
        self.type = type
        self.status = status
        self.conflictKey = conflictKey
        self.roomId = roomId
        self.payloadJSON = payloadJSON
        self.idempotencyKey = idempotencyKey
        self.clientMessageId = clientMessageId
        self.recordedAt = recordedAt
        self.role = role
    }
}

public enum CheckInEnqueue: Equatable, Sendable {
    case queued(StoredOperation)
    case rejected(String)
}

public enum PingEnqueue: Equatable, Sendable {
    case queued(StoredOperation)
    case rejected(String)
}

public struct FlushReport: Equatable, Sendable {
    public var accepted: [String]
    public var dropped: [String]
    public var rejected: [String]
    public var pending: [String]
    /// The server answered 401. The flush stopped and left the rest queued for the session wipe.
    public var sessionExpired: Bool

    public init(
        accepted: [String] = [],
        dropped: [String] = [],
        rejected: [String] = [],
        pending: [String] = [],
        sessionExpired: Bool = false
    ) {
        self.accepted = accepted
        self.dropped = dropped
        self.rejected = rejected
        self.pending = pending
        self.sessionExpired = sessionExpired
    }
}

public enum OutboxStoreError: Error, Equatable, Sendable {
    /// The store was wiped (sign-out or session expiry). A stale reference can't write again.
    case closed
}

/// File-backed outbox, one actor per file per process (`shared`).
///
/// Every mutation re-reads the file inside the actor and writes back only the rows it owns,
/// so no writer saves a list it read earlier. "In flight" is memory-only: a relaunch finds
/// those rows still pending and sends them again with the same ids and idempotency keys.
public actor OutboxStore: UserDataStore {
    public let userId: String
    public nonisolated let fileURL: URL
    private nonisolated let file: OutboxFile
    private var inFlight: Set<String> = []

    /// The process-wide store for `directory`. Two callers on the same file always share one
    /// actor, so their mutations queue behind each other instead of racing on disk.
    public static func shared(userId: String, directory: URL) throws -> OutboxStore {
        try SharedOutboxStores.instance.store(userId: userId, directory: directory)
    }

    /// Closes and deletes every shared store under `directory`. Used before a user directory is removed.
    static func wipeShared(inside directory: URL) throws {
        for store in SharedOutboxStores.instance.remove(inside: directory) {
            try store.wipe()
        }
    }

    /// Simulates a relaunch for one directory: the next `shared` call opens a fresh actor with no
    /// memory of in-flight sends. The file is untouched.
    static func forgetSharedStoreForTesting(directory: URL) {
        _ = SharedOutboxStores.instance.remove(inside: directory)
    }

    init(userId: String, directory: URL) throws {
        self.userId = userId
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.fileURL = directory.appendingPathComponent("outbox.json")
        self.file = OutboxFile(
            outbox: fileURL,
            watermarks: directory.appendingPathComponent("ping-watermarks.json")
        )
        try file.reclaimSending()
    }

    /// Deletes the queue and closes this store. Later writes through any reference throw `closed`.
    public nonisolated func wipe() throws {
        try file.close()
        SharedOutboxStores.instance.forget(self)
    }

    public func operations() throws -> [StoredOperation] {
        try load()
    }

    /// Room list mutations (chat) re-read the file inside the actor before writing. The body is
    /// synchronous, so nothing else can run between the read and the write.
    public func mutate(roomId: String, type: String = "chat", _ body: (inout [StoredOperation]) -> Void) throws {
        var all = try load()
        var mine = all.filter { $0.roomId == roomId && $0.type == type }
        body(&mine)
        all.removeAll { $0.roomId == roomId && $0.type == type }
        all.append(contentsOf: mine)
        try save(all)
    }

    /// Queues a chat message under its stable client message id. Re-queueing the same id replaces it.
    public func enqueueChat(roomId: String, text: String, clientMessageId: String, role: String) throws -> StoredOperation {
        let payload = try Self.json(["text": text, "clientMessageId": clientMessageId])
        let operation = StoredOperation(
            id: clientMessageId,
            type: "chat",
            conflictKey: "chat:\(clientMessageId)",
            roomId: roomId,
            payloadJSON: payload,
            idempotencyKey: IdempotencyKey.hashPayload(payload),
            clientMessageId: clientMessageId,
            role: role
        )
        try mutate(roomId: roomId, type: "chat") { operations in
            if let index = operations.firstIndex(where: { $0.clientMessageId == clientMessageId }) {
                operations[index] = operation
            } else {
                operations.append(operation)
            }
        }
        return operation
    }

    /// Pending chat for one room that no one is sending yet. The claim lives in memory only.
    public func claimPendingChat(roomId: String) throws -> [StoredOperation] {
        let claimed = try load().filter {
            $0.roomId == roomId && $0.type == "chat" && $0.status == "pending" && !inFlight.contains($0.id)
        }
        inFlight.formUnion(claimed.map(\.id))
        return claimed
    }

    /// Claims one pending chat message (the send that just queued it). False when it is gone or already claimed.
    public func claimChat(id: String) throws -> Bool {
        guard !inFlight.contains(id),
              try load().contains(where: { $0.id == id && $0.type == "chat" && $0.status == "pending" }) else {
            return false
        }
        inFlight.insert(id)
        return true
    }

    /// Ends a claim. Delivered, or already on the server, removes the message; anything else keeps it pending.
    public func settleChat(id: String, error: (any Error)?) throws {
        inFlight.remove(id)
        if let error, !OutboxPolicy.isAlreadyDelivered(error) {
            return
        }
        try complete(id: id)
    }

    /// Athlete sessions only. `recordedAt` must be after every ping this store ever queued for the
    /// room, not just the ones still pending, so a flush can't reopen an older timestamp.
    public func enqueuePing(
        roomId: String,
        role: String,
        latitude: Double,
        longitude: Double,
        recordedAt: String,
        horizontalAccuracyMeters: Double? = nil
    ) throws -> PingEnqueue {
        guard PingPolicy.mayUpload(role: role) else {
            return .rejected("Only the athlete uploads location.")
        }
        guard let next = ScheduleFormat.parseISO8601(recordedAt) else {
            return .rejected("Couldn't read recordedAt.")
        }
        var all = try load()
        var watermarks = try file.readWatermarks()
        let pending = all.compactMap { op -> Date? in
            guard op.roomId == roomId, op.type == "ping", let recorded = op.recordedAt else { return nil }
            return ScheduleFormat.parseISO8601(recorded)
        }
        let queuedBefore = watermarks[roomId].flatMap(ScheduleFormat.parseISO8601)
        if let latest = (pending + [queuedBefore].compactMap { $0 }).max(), next <= latest {
            return .rejected("recordedAt must increase.")
        }
        var object: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "recordedAt": recordedAt
        ]
        if let horizontalAccuracyMeters {
            object["horizontalAccuracyMeters"] = horizontalAccuracyMeters
        }
        let json = try Self.json(object)
        let operation = StoredOperation(
            id: "ping-\(recordedAt)",
            type: "ping",
            conflictKey: "ping:\(roomId)",
            roomId: roomId,
            payloadJSON: json,
            idempotencyKey: IdempotencyKey.hashPayload(json),
            clientMessageId: "ping-\(roomId)-\(recordedAt)",
            recordedAt: recordedAt,
            role: role
        )
        if let index = all.firstIndex(where: {
            $0.status == "pending" && $0.conflictKey == operation.conflictKey && !inFlight.contains($0.id)
        }) {
            all[index] = operation
        } else {
            all.append(operation)
        }
        try save(all)
        watermarks[roomId] = recordedAt
        try file.writeWatermarks(watermarks)
        return .queued(operation)
    }

    public func enqueueCheckIn(
        roomId: String,
        checkpointId: String,
        arrivalAt: String,
        departureAt: String,
        role: String
    ) throws -> CheckInEnqueue {
        switch CheckIn.validate(arrivalAt: arrivalAt, departureAt: departureAt) {
        case .invalid(let message):
            return .rejected(message)
        case .ok(let arrival, let departure):
            let payload = #"{"arrivalAt":"\#(arrival)","departureAt":"\#(departure)","checkpointId":"\#(checkpointId)"}"#
            let clientMessageId = "check-in-\(roomId)-\(checkpointId)-\(arrival)"
            let operation = StoredOperation(
                id: clientMessageId,
                type: "check-in",
                conflictKey: "check-in:\(roomId):\(checkpointId):\(clientMessageId)",
                roomId: roomId,
                payloadJSON: payload,
                idempotencyKey: IdempotencyKey.hashPayload(payload),
                clientMessageId: clientMessageId,
                role: role
            )
            var all = try load()
            all.append(operation)
            try save(all)
            return .queued(operation)
        }
    }

    public func enqueuePush(deviceId: String, platform: String, token: String, role: String) throws -> StoredOperation {
        let payload = #"{"deviceId":"\#(deviceId)","platform":"\#(platform)","token":"\#(token)"}"#
        let operation = StoredOperation(
            id: "push-\(deviceId)",
            type: "push",
            conflictKey: "push:\(deviceId)",
            roomId: "",
            payloadJSON: payload,
            idempotencyKey: IdempotencyKey.hashPayload(payload),
            clientMessageId: "push-\(deviceId)",
            role: role
        )
        var all = try load()
        if let index = all.firstIndex(where: { $0.conflictKey == operation.conflictKey && $0.status == "pending" }) {
            all[index] = operation
        } else {
            all.append(operation)
        }
        try save(all)
        return operation
    }

    public func enqueueGpx(roomId: String, fileName: String, gpxXml: String, raceStartAt: String, plannedPaceSecondsPerKm: Double, role: String) throws -> StoredOperation {
        let payload: [String: Any] = [
            "fileName": fileName,
            "gpxXml": gpxXml,
            "raceStartAt": raceStartAt,
            "plannedPaceSecondsPerKm": plannedPaceSecondsPerKm
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let json = String(decoding: data, as: UTF8.self)
        let operation = StoredOperation(
            id: "gpx-\(roomId)-\(fileName)",
            type: "gpx",
            conflictKey: "gpx:\(roomId)",
            roomId: roomId,
            payloadJSON: json,
            idempotencyKey: IdempotencyKey.hashPayload(json),
            clientMessageId: "gpx-\(roomId)-\(fileName)",
            role: role
        )
        var all = try load()
        if let index = all.firstIndex(where: { $0.conflictKey == operation.conflictKey && $0.status == "pending" }) {
            all[index] = operation
        } else {
            all.append(operation)
        }
        try save(all)
        return operation
    }

    /// Sends the pending snapshot. Each result is merged into the file as it is now: only the exact
    /// version that was sent (same id and idempotency key) is removed or marked, so anything queued
    /// or replaced during the send survives. Chat is delivered by the chat screen, not here.
    public func flush(_ sender: @Sendable (StoredOperation) async -> OutboxFailureResolution) async throws -> FlushReport {
        var report = FlushReport()
        let pending = try load().filter { $0.status == "pending" && !inFlight.contains($0.id) }
        report.pending.append(contentsOf: pending.filter { $0.type == "chat" }.map(\.id))
        let snapshot = pending.filter { $0.type != "chat" }
        let ids = Set(snapshot.map(\.id))
        inFlight.formUnion(ids)
        defer { inFlight.subtract(ids) }
        do {
            for operation in snapshot {
                let resolution: OutboxFailureResolution
                if operation.type == "ping" && !PingPolicy.mayUpload(role: operation.role) {
                    resolution = OutboxFailureResolution(status: "dropped", retryable: false, feedback: "Only the athlete uploads location.")
                } else {
                    resolution = await sender(operation)
                }
                if resolution.status == "expired" {
                    report.sessionExpired = true
                    break
                }
                try settle(operation, resolution, into: &report)
            }
        } catch OutboxStoreError.closed {
            return report
        }
        return report
    }

    private func settle(_ operation: StoredOperation, _ resolution: OutboxFailureResolution, into report: inout FlushReport) throws {
        var current = try load()
        guard let index = current.firstIndex(where: {
            $0.id == operation.id && $0.idempotencyKey == operation.idempotencyKey
        }) else {
            // Replaced or removed while it was in flight. The newer version stays queued.
            switch resolution.status {
            case "accepted": report.accepted.append(operation.id)
            case "dropped": report.dropped.append(operation.id)
            default: break
            }
            return
        }
        switch resolution.status {
        case "accepted":
            current.remove(at: index)
            report.accepted.append(operation.id)
        case "dropped":
            current.remove(at: index)
            report.dropped.append(operation.id)
        case "rejected", "conflict":
            current[index].status = resolution.status
            report.rejected.append(operation.id)
        default:
            report.pending.append(operation.id)
            return
        }
        try save(current)
    }

    public func complete(id: String) throws {
        inFlight.remove(id)
        var all = try load()
        all.removeAll { $0.id == id }
        try save(all)
    }

    public nonisolated func path(for operation: StoredOperation) -> String? {
        switch operation.type {
        case "ping":
            return "/race-rooms/\(operation.roomId)/pings"
        case "check-in":
            guard let checkpoint = Self.checkpointId(in: operation.payloadJSON) else { return nil }
            return "/race-rooms/\(operation.roomId)/checkpoints/\(checkpoint)/manual-stop"
        case "push":
            return "/chat/push/tokens"
        default:
            return nil
        }
    }

    private nonisolated static func checkpointId(in payload: String) -> String? {
        guard let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = object["checkpointId"] as? String else {
            return nil
        }
        return id
    }

    private func load() throws -> [StoredOperation] {
        try file.read()
    }

    private func save(_ operations: [StoredOperation]) throws {
        try file.write(operations)
    }

    nonisolated static func json(_ object: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    fileprivate nonisolated static func encodeOperations(_ operations: [StoredOperation]) throws -> Data {
        let objects: [[String: Any]] = operations.map { operation in
            var object: [String: Any] = [
                "clientMessageId": operation.clientMessageId,
                "conflictKey": operation.conflictKey,
                "id": operation.id,
                "idempotencyKey": operation.idempotencyKey,
                "payloadJSON": operation.payloadJSON,
                "role": operation.role,
                "roomId": operation.roomId,
                "status": operation.status,
                "type": operation.type
            ]
            if let recordedAt = operation.recordedAt {
                object["recordedAt"] = recordedAt
            }
            return object
        }
        return try JSONSerialization.data(withJSONObject: objects)
    }

    fileprivate nonisolated static func decodeOperations(_ data: Data) throws -> [StoredOperation] {
        if data.isEmpty { return [] }
        let raw = try JSONSerialization.jsonObject(with: data)
        guard let rows = raw as? [Any] else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Couldn't read the outbox."))
        }
        return try rows.map { row in
            guard let object = dictionary(row), let operation = operation(from: object) else {
                throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Couldn't read the outbox."))
            }
            return operation
        }
    }

    private nonisolated static func dictionary(_ row: Any) -> [String: Any]? {
        if let object = row as? [String: Any] {
            return object
        }
        guard let dictionary = row as? NSDictionary else { return nil }
        var object: [String: Any] = [:]
        for (key, value) in dictionary {
            guard let key = key as? String else { continue }
            object[key] = value
        }
        return object
    }

    private nonisolated static func operation(from object: [String: Any]) -> StoredOperation? {
        guard let id = object["id"] as? String,
              let type = object["type"] as? String,
              let status = object["status"] as? String,
              let conflictKey = object["conflictKey"] as? String,
              let roomId = object["roomId"] as? String,
              let payloadJSON = object["payloadJSON"] as? String,
              let idempotencyKey = object["idempotencyKey"] as? String,
              let clientMessageId = object["clientMessageId"] as? String,
              let role = object["role"] as? String else {
            return nil
        }
        return StoredOperation(
            id: id,
            type: type,
            status: status,
            conflictKey: conflictKey,
            roomId: roomId,
            payloadJSON: payloadJSON,
            idempotencyKey: idempotencyKey,
            clientMessageId: clientMessageId,
            recordedAt: object["recordedAt"] as? String,
            role: role
        )
    }
}

public enum PingPolicy {
    /// Race progress comes from the runner's phone. No other session uploads location.
    public static func mayUpload(role: String) -> Bool {
        role == "athlete"
    }
}

/// The outbox and ping-watermark files behind one lock. Closing deletes both and refuses
/// every later read-modify-write, so a wipe can't be undone by a writer that was mid-flight.
private final class OutboxFile: @unchecked Sendable {
    private let lock = NSLock()
    private let outbox: URL
    private let watermarks: URL
    private var closed = false

    init(outbox: URL, watermarks: URL) {
        self.outbox = outbox
        self.watermarks = watermarks
    }

    func read() throws -> [StoredOperation] {
        try locked {
            guard FileManager.default.fileExists(atPath: outbox.path) else { return [] }
            return try OutboxStore.decodeOperations(Data(contentsOf: outbox))
        }
    }

    func write(_ operations: [StoredOperation]) throws {
        try locked {
            // Hand-built JSON. JSONEncoder's synthesized StoredOperation witness segfaults on Android.
            try OutboxStore.encodeOperations(operations).write(to: outbox, options: .atomic)
        }
    }

    func readWatermarks() throws -> [String: String] {
        try locked {
            guard FileManager.default.fileExists(atPath: watermarks.path) else { return [:] }
            let data = try Data(contentsOf: watermarks)
            guard !data.isEmpty else { return [:] }
            return (try JSONSerialization.jsonObject(with: data) as? [String: String]) ?? [:]
        }
    }

    func writeWatermarks(_ values: [String: String]) throws {
        try locked {
            try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]).write(to: watermarks, options: .atomic)
        }
    }

    /// Builds before #538 persisted "sending". In flight is memory-only now, so those rows are pending again.
    func reclaimSending() throws {
        try locked {
            guard FileManager.default.fileExists(atPath: outbox.path) else { return }
            var all = try OutboxStore.decodeOperations(Data(contentsOf: outbox))
            var changed = false
            for index in all.indices where all[index].status == "sending" {
                all[index].status = "pending"
                changed = true
            }
            if changed {
                try OutboxStore.encodeOperations(all).write(to: outbox, options: .atomic)
            }
        }
    }

    func close() throws {
        lock.lock()
        defer { lock.unlock() }
        closed = true
        for url in [outbox, watermarks] where FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    private func locked<T>(_ body: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { throw OutboxStoreError.closed }
        return try body()
    }
}

/// One `OutboxStore` per outbox file in this process. The Android bridge opens a store on every
/// call; sharing the actor is what serializes those calls and their in-flight sets.
private final class SharedOutboxStores: @unchecked Sendable {
    static let instance = SharedOutboxStores()

    private let lock = NSLock()
    private var stores: [String: OutboxStore] = [:]

    func store(userId: String, directory: URL) throws -> OutboxStore {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let key = Self.key(directory.appendingPathComponent("outbox.json"))
        lock.lock()
        defer { lock.unlock() }
        if let existing = stores[key] {
            return existing
        }
        let created = try OutboxStore(userId: userId, directory: directory)
        stores[key] = created
        return created
    }

    func forget(_ store: OutboxStore) {
        let key = Self.key(store.fileURL)
        lock.lock()
        if stores[key] === store {
            stores[key] = nil
        }
        lock.unlock()
    }

    func remove(inside directory: URL) -> [OutboxStore] {
        let prefix = Self.key(directory).hasSuffix("/") ? Self.key(directory) : Self.key(directory) + "/"
        lock.lock()
        defer { lock.unlock() }
        let matches = stores.filter { $0.key.hasPrefix(prefix) }
        for key in matches.keys {
            stores[key] = nil
        }
        return Array(matches.values)
    }

    private static func key(_ url: URL) -> String {
        url.standardizedFileURL.resolvingSymlinksInPath().path
    }
}
