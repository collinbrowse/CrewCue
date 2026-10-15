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

    public init(accepted: [String] = [], dropped: [String] = [], rejected: [String] = [], pending: [String] = []) {
        self.accepted = accepted
        self.dropped = dropped
        self.rejected = rejected
        self.pending = pending
    }
}

/// File-backed outbox. "sending" is memory-only, so a relaunch reclaims a crash mid-flush.
public actor OutboxStore: UserDataStore {
    public let userId: String
    public nonisolated let fileURL: URL
    private var inFlight: Set<String> = []

    public init(userId: String, directory: URL) throws {
        self.userId = userId
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.fileURL = directory.appendingPathComponent("outbox.json")
        try Self.reclaimSending(at: fileURL)
    }

    public nonisolated func wipe() throws {
        let url = fileURL
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    public func operations() throws -> [StoredOperation] {
        try load()
    }

    /// Chat (and any room list) mutations re-read the file inside the actor before writing.
    public func mutate(roomId: String, type: String = "chat", _ body: (inout [StoredOperation]) -> Void) throws {
        var all = try load()
        var mine = all.filter { $0.roomId == roomId && $0.type == type }
        body(&mine)
        all.removeAll { $0.roomId == roomId && $0.type == type }
        all.append(contentsOf: mine)
        try save(all)
    }

    public func enqueuePing(
        roomId: String,
        role: String,
        latitude: Double,
        longitude: Double,
        recordedAt: String,
        horizontalAccuracyMeters: Double? = nil
    ) throws -> PingEnqueue {
        guard role == "athlete" else {
            return .rejected("Only the athlete uploads location.")
        }
        var all = try load()
        let previous = all.compactMap { op -> Date? in
            guard op.roomId == roomId, op.type == "ping", op.status == "pending", let recorded = op.recordedAt else {
                return nil
            }
            return ScheduleFormat.parseISO8601(recorded)
        }
        guard let next = ScheduleFormat.parseISO8601(recordedAt) else {
            return .rejected("Couldn't read recordedAt.")
        }
        if let latest = previous.max(), next <= latest {
            return .rejected("recordedAt must increase.")
        }
        let payload: [String: Any] = {
            var object: [String: Any] = [
                "latitude": latitude,
                "longitude": longitude,
                "recordedAt": recordedAt
            ]
            if let horizontalAccuracyMeters {
                object["horizontalAccuracyMeters"] = horizontalAccuracyMeters
            }
            return object
        }()
        let data = try JSONSerialization.data(withJSONObject: payload)
        let json = String(decoding: data, as: UTF8.self)
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
        if let index = all.firstIndex(where: { $0.status == "pending" && $0.conflictKey == operation.conflictKey }) {
            all[index] = operation
        } else {
            all.append(operation)
        }
        try save(all)
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

    /// Sends the pending snapshot. Operations queued during the send stay on disk.
    public func flush(_ sender: @Sendable (StoredOperation) async -> OutboxFailureResolution) async throws -> FlushReport {
        let snapshot = try load().filter { $0.status == "pending" && !inFlight.contains($0.id) }
        let ids = Set(snapshot.map(\.id))
        for id in ids {
            inFlight.insert(id)
        }
        defer {
            for id in ids {
                inFlight.remove(id)
            }
        }
        var report = FlushReport()
        for operation in snapshot {
            let resolution = await sender(operation)
            var current = try load()
            guard let index = current.firstIndex(where: { $0.id == operation.id }) else {
                continue
            }
            switch resolution.status {
            case "accepted", "dropped":
                current.remove(at: index)
                if resolution.status == "dropped" {
                    report.dropped.append(operation.id)
                } else {
                    report.accepted.append(operation.id)
                }
            case "rejected", "conflict":
                current[index].status = resolution.status
                report.rejected.append(operation.id)
            default:
                report.pending.append(operation.id)
            }
            try save(current)
        }
        return report
    }

    public func complete(id: String) throws {
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

    private nonisolated static func reclaimSending(at fileURL: URL) throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        var all = try decodeOperations(Data(contentsOf: fileURL))
        var changed = false
        for index in all.indices where all[index].status == "sending" {
            all[index].status = "pending"
            changed = true
        }
        if changed {
            try encodeOperations(all).write(to: fileURL, options: .atomic)
        }
    }

    private func load() throws -> [StoredOperation] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        return try Self.decodeOperations(Data(contentsOf: fileURL))
    }

    private func save(_ operations: [StoredOperation]) throws {
        // Hand-built JSON. JSONEncoder's synthesized StoredOperation witness segfaults on Android.
        try Self.encodeOperations(operations).write(to: fileURL, options: .atomic)
    }

    private nonisolated static func encodeOperations(_ operations: [StoredOperation]) throws -> Data {
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

    private nonisolated static func decodeOperations(_ data: Data) throws -> [StoredOperation] {
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
