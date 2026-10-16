import Foundation
import Testing
@testable import CrewCueClientCore

// Issue #538: offline outbox, session and ping invariants.

// MARK: 1. Chat outbox, no lost updates

@Test func bridgeChatEnqueuesFromManyCallsKeepEveryMessage() async throws {
    let root = temporaryDirectory()
    let count = 40
    try await withThrowingTaskGroup(of: Void.self) { group in
        for index in 0..<count {
            group.addTask {
                let response = try await runtime([
                    "op": "enqueueChat",
                    "storageDir": root.path,
                    "userId": "crew-1",
                    "role": "crew_member",
                    "roomId": "room",
                    "text": "Message \(index)",
                    "clientMessageId": "m-\(index)"
                ])
                #expect(flag(response, "ok"))
            }
        }
        try await group.waitForAll()
    }
    let listed = try resultObject(try await runtime([
        "op": "listOutbox",
        "storageDir": root.path,
        "userId": "crew-1"
    ]))
    let rows = try #require(listed["operations"] as? [[String: Any]])
    #expect(Set(rows.compactMap { $0["id"] as? String }) == Set((0..<count).map { "m-\($0)" }))
}

// MARK: 2. Sync outbox flush keeps new work

@Test func flushOnlyRemovesTheVersionItSent() async throws {
    let store = try OutboxStore.shared(userId: "crew-1", directory: temporaryDirectory())
    let first = try await store.enqueuePush(deviceId: "device-1", platform: "ios", token: "old-token", role: "crew_member")
    let gate = Gate()
    let flushing = Task {
        try await store.flush { _ in
            await gate.wait()
            return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
        }
    }
    await gate.waitUntilWaiting()
    let second = try await store.enqueuePush(deviceId: "device-1", platform: "ios", token: "new-token", role: "crew_member")
    #expect(first.id == second.id)
    await gate.open()
    let report = try await flushing.value
    #expect(report.accepted == [first.id])
    let remaining = try await store.operations()
    #expect(remaining.count == 1)
    #expect(remaining.first?.payloadJSON.contains("new-token") == true)
    #expect(remaining.first?.status == "pending")
}

@Test func checkInsQueuedDuringAFlushAllSurvive() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    for minute in 0..<5 {
        _ = try await store.enqueueCheckIn(
            roomId: "room",
            checkpointId: "sent-\(minute)",
            arrivalAt: "2026-08-15T14:\(10 + minute):00.000Z",
            departureAt: "2026-08-15T14:\(10 + minute):30.000Z",
            role: "athlete"
        )
    }
    let queuedDuringFlush = 25
    let report = try await withThrowingTaskGroup(of: FlushReport?.self) { group in
        group.addTask {
            try await store.flush { _ in
                await Task.yield()
                return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
            }
        }
        for index in 0..<queuedDuringFlush {
            group.addTask {
                await Task.yield()
                _ = try await store.enqueueCheckIn(
                    roomId: "room",
                    checkpointId: "late-\(index)",
                    arrivalAt: "2026-08-15T15:00:00.000Z",
                    departureAt: "2026-08-15T15:05:00.000Z",
                    role: "athlete"
                )
                return nil
            }
        }
        var flushed: FlushReport?
        for try await value in group {
            if let value { flushed = value }
        }
        return try #require(flushed)
    }
    let remaining = try await store.operations()
    let sent = Set(report.accepted)
    let late = remaining.filter { $0.id.contains("late-") }
    // Whatever the flush did not send is still queued; nothing queued mid-flush was lost.
    #expect(remaining.allSatisfy { !sent.contains($0.id) })
    #expect(late.count + report.accepted.filter { $0.contains("late-") }.count == queuedDuringFlush)
    #expect(report.accepted.filter { $0.contains("sent-") }.count == 5)
}

@Test func concurrentFlushesSendEachOperationOnce() async throws {
    let directory = temporaryDirectory()
    let seed = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    for index in 0..<10 {
        _ = try await seed.enqueueCheckIn(
            roomId: "room",
            checkpointId: "aid-\(index)",
            arrivalAt: "2026-08-15T14:10:00.000Z",
            departureAt: "2026-08-15T14:16:00.000Z",
            role: "athlete"
        )
    }
    let counter = SendCounter()
    try await withThrowingTaskGroup(of: Void.self) { group in
        for _ in 0..<4 {
            group.addTask {
                let store = try OutboxStore.shared(userId: "athlete-1", directory: directory)
                _ = try await store.flush { operation in
                    await counter.record(operation.id)
                    await Task.yield()
                    return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
                }
            }
        }
        try await group.waitForAll()
    }
    let sends = await counter.counts()
    #expect(sends.count == 10)
    #expect(sends.values.allSatisfy { $0 == 1 })
    #expect(try await seed.operations().isEmpty)
}

// MARK: 3. Crash recovery for sends

@Test func inFlightIsNeverWrittenToDisk() async throws {
    let directory = temporaryDirectory()
    let store = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    _ = try await store.enqueueCheckIn(
        roomId: "room",
        checkpointId: "aid-1",
        arrivalAt: "2026-08-15T14:10:00.000Z",
        departureAt: "2026-08-15T14:16:00.000Z",
        role: "athlete"
    )
    let file = store.fileURL
    _ = try await store.flush { _ in
        let raw = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
        #expect(raw.contains("\"status\":\"pending\""))
        #expect(!raw.contains("sending"))
        return OutboxFailureResolution(status: "pending", retryable: true, feedback: "Offline.")
    }
}

@Test func relaunchMidSendResendsWithTheSameIds() async throws {
    let directory = temporaryDirectory()
    let before = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    guard case .queued(let queued) = try await before.enqueueCheckIn(
        roomId: "room",
        checkpointId: "aid-1",
        arrivalAt: "2026-08-15T14:10:00.000Z",
        departureAt: "2026-08-15T14:16:00.000Z",
        role: "athlete"
    ) else {
        Issue.record("expected the check-in to queue")
        return
    }
    let gate = Gate()
    let crashed = Task {
        try await before.flush { _ in
            await gate.wait()
            return OutboxFailureResolution(status: "pending", retryable: true, feedback: "Lost.")
        }
    }
    await gate.waitUntilWaiting()

    // The process dies mid-send. A fresh process opens the same file.
    OutboxStore.forgetSharedStoreForTesting(directory: directory)
    let after = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    #expect(after !== before)
    let resentLog = OperationLog()
    let report = try await after.flush { operation in
        await resentLog.append(operation)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
    }
    #expect(report.accepted == [queued.id])
    let resent = await resentLog.operations
    #expect(resent.map(\.clientMessageId) == [queued.clientMessageId])
    #expect(resent.map(\.idempotencyKey) == [queued.idempotencyKey])
    await gate.open()
    _ = try await crashed.value
    #expect(try await after.operations().isEmpty)
}

@Test func serverAlreadyExistsCountsAsDelivered() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    _ = try await store.enqueueCheckIn(
        roomId: "room",
        checkpointId: "aid-1",
        arrivalAt: "2026-08-15T14:10:00.000Z",
        departureAt: "2026-08-15T14:16:00.000Z",
        role: "athlete"
    )
    let transport = ScriptedTransport(status: 409, body: #"{"error":"Check-in already exists"}"#)
    let report = try await RaceDayAPI.flushOutbox(graph: graph(transport: transport, outbox: store))
    #expect(report.accepted.count == 1)
    #expect(try await store.operations().isEmpty)

    #expect(OutboxPolicy.isAlreadyDelivered(StreamStyleError(description: #"Message with id "m-1" already exists"#)))
    #expect(!OutboxPolicy.isAlreadyDelivered(StreamStyleError(description: "The request timed out.")))
}

@Test func claimedChatIsHandedOutOnceAndReclaimedAfterRelaunch() async throws {
    let directory = temporaryDirectory()
    let store = try OutboxStore.shared(userId: "crew-1", directory: directory)
    _ = try await store.enqueueChat(roomId: "room", text: "On my way", clientMessageId: "m-1", role: "crew_member")
    _ = try await store.enqueueChat(roomId: "other", text: "Elsewhere", clientMessageId: "m-2", role: "crew_member")
    let claimed = try await store.claimPendingChat(roomId: "room")
    #expect(claimed.map(\.clientMessageId) == ["m-1"])
    #expect(try await store.claimPendingChat(roomId: "room").isEmpty)

    // Relaunch: the memory-only claim is gone, the message is still pending on disk.
    OutboxStore.forgetSharedStoreForTesting(directory: directory)
    let relaunched = try OutboxStore.shared(userId: "crew-1", directory: directory)
    let reclaimed = try await relaunched.claimPendingChat(roomId: "room")
    #expect(reclaimed.map(\.clientMessageId) == ["m-1"])

    try await relaunched.settleChat(id: "m-1", error: StreamStyleError(description: "timeout"))
    #expect(try await relaunched.operations().contains { $0.id == "m-1" && $0.status == "pending" })
    #expect(try await relaunched.claimPendingChat(roomId: "room").map(\.id) == ["m-1"])
    try await relaunched.settleChat(id: "m-1", error: StreamStyleError(description: "message already exists"))
    #expect(try await relaunched.operations().map(\.id) == ["m-2"])
}

@Test func bridgeSettleChatTreatsAlreadyExistsAsDelivered() async throws {
    let root = temporaryDirectory()
    let base: [String: Any] = ["storageDir": root.path, "userId": "crew-1", "role": "crew_member", "roomId": "room"]
    _ = try await runtime(base.merging(["op": "enqueueChat", "text": "Hi", "clientMessageId": "m-1"]) { $1 })
    let claimed = try resultObject(try await runtime(base.merging(["op": "claimPendingChat"]) { $1 }))
    let rows = try #require(claimed["messages"] as? [[String: Any]])
    #expect(rows.compactMap { $0["clientMessageId"] as? String } == ["m-1"])
    #expect(rows.compactMap { $0["text"] as? String } == ["Hi"])

    let retry = try resultObject(try await runtime(base.merging(["op": "settleChat", "id": "m-1", "error": "socket closed"]) { $1 }))
    #expect((retry["status"] as? String) == "pending")
    let done = try resultObject(try await runtime(base.merging(["op": "settleChat", "id": "m-1", "error": "a message with ID m-1 already exists"]) { $1 }))
    #expect((done["status"] as? String) == "delivered")
}

// MARK: 4. No data across accounts

@Test func signOutRunsEveryWiperEvenWhenOneFails() throws {
    let session = SessionController(session: ClientSession(userId: "athlete-1", role: "athlete"))
    let ran = Flags()
    let names = (0..<20).map { "store-\($0)" }
    session.register(id: "broken") { throw CocoaError(.fileWriteNoPermission) }
    for name in names {
        session.register(id: name) { ran.set(name) }
    }
    #expect(throws: (any Error).self) { try session.signOut() }
    #expect(ran.values == names.sorted())
    #expect(session.session == nil)
}

@Test func wipedStoreCannotBeWrittenAgain() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    _ = try await store.enqueuePush(deviceId: "d", platform: "ios", token: "t", role: "athlete")
    try store.wipe()
    // A stale reference (a model that still holds the store) must not resurrect the old account's queue.
    await #expect(throws: (any Error).self) {
        _ = try await store.enqueuePush(deviceId: "d", platform: "ios", token: "t2", role: "athlete")
    }
    #expect(!FileManager.default.fileExists(atPath: store.fileURL.path))
}

@Test func wipeDuringAFlushLeavesNothingBehind() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    _ = try await store.enqueuePush(deviceId: "d", platform: "ios", token: "t", role: "athlete")
    let gate = Gate()
    let flushing = Task {
        try await store.flush { _ in
            await gate.wait()
            return OutboxFailureResolution(status: "rejected", retryable: false, feedback: "No.")
        }
    }
    await gate.waitUntilWaiting()
    try store.wipe()
    await gate.open()
    _ = try? await flushing.value
    #expect(!FileManager.default.fileExists(atPath: store.fileURL.path))
}

@Test func secondAccountNeverDrainsTheFirstAccountsQueue() async throws {
    let root = temporaryDirectory()
    let queued = try await runtime([
        "op": "enqueueCheckIn",
        "storageDir": root.path,
        "userId": "athlete-a",
        "role": "athlete",
        "roomId": "room",
        "checkpointId": "aid-1",
        "arrivalAt": "2026-08-15T14:10:00.000Z",
        "departureAt": "2026-08-15T14:16:00.000Z"
    ])
    #expect(flag(queued, "ok"))
    let other = try resultObject(try await runtime([
        "op": "listOutbox",
        "storageDir": root.path,
        "userId": "athlete-b"
    ]))
    #expect(number(other["pending"]) == 0)
    let owner = try resultObject(try await runtime([
        "op": "listOutbox",
        "storageDir": root.path,
        "userId": "athlete-a"
    ]))
    #expect(number(owner["pending"]) == 1)
}

@Test func userStorageListsAndWipesEveryAccount() throws {
    let storage = UserStorage(root: temporaryDirectory())
    let first = try storage.directory(userId: "auth0|abc/123")
    let second = try storage.directory(userId: "google-oauth2|xyz")
    try Data("{}".utf8).write(to: first.appendingPathComponent("outbox.json"))
    let room = RoomStorage.directory(userDirectory: second, roomId: "room")
    try FileManager.default.createDirectory(at: room, withIntermediateDirectories: true)
    try Data("{}".utf8).write(to: room.appendingPathComponent("schedule.json"))
    #expect(first != second)
    #expect(try Set(storage.userIds()) == ["auth0|abc/123", "google-oauth2|xyz"])

    try storage.wipeAll(except: "google-oauth2|xyz")
    #expect(try storage.userIds() == ["google-oauth2|xyz"])
    try storage.wipeAll()
    #expect(try storage.userIds().isEmpty)
    #expect(!FileManager.default.fileExists(atPath: room.path))
}

@Test func bridgeWipeUserDataClearsEveryAccountUnderTheRoot() async throws {
    let root = temporaryDirectory()
    for user in ["athlete-a", "crew-b"] {
        _ = try await runtime([
            "op": "enqueuePush",
            "storageDir": root.path,
            "userId": user,
            "role": "crew_member",
            "deviceId": "device",
            "token": "t"
        ])
    }
    #expect(try Set(UserStorage(root: root).userIds()) == ["athlete-a", "crew-b"])
    let wiped = try await runtime(["op": "wipeUserData", "storageDir": root.path])
    #expect(flag(wiped, "ok"))
    #expect(try UserStorage(root: root).userIds().isEmpty)
    let after = try resultObject(try await runtime(["op": "listOutbox", "storageDir": root.path, "userId": "athlete-a"]))
    #expect(number(after["pending"]) == 0)
}

@Test func expiredSessionStopsTheFlushWithoutRejectingWork() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    for index in 0..<3 {
        _ = try await store.enqueueCheckIn(
            roomId: "room",
            checkpointId: "aid-\(index)",
            arrivalAt: "2026-08-15T14:10:00.000Z",
            departureAt: "2026-08-15T14:16:00.000Z",
            role: "athlete"
        )
    }
    let transport = ScriptedTransport(status: 401, body: #"{"error":"Unauthorized"}"#)
    let report = try await RaceDayAPI.flushOutbox(graph: graph(transport: transport, outbox: store))
    #expect(report.sessionExpired)
    #expect(report.rejected.isEmpty)
    #expect(await transport.requestCount() == 1)
    #expect(try await store.operations().allSatisfy { $0.status == "pending" })
}

@Test func sessionExpiryTransportReportsAuthorizedFourOhOne() async throws {
    let expired = Flags()
    let transport = SessionExpiryTransport(
        wrapping: ScriptedTransport(status: 401, body: #"{"error":"Unauthorized"}"#),
        onExpired: { expired.set("expired") }
    )
    let url = URL(string: "https://example.invalid/me")!
    _ = try await transport.send(HTTPRequest(url: url, method: .get))
    #expect(expired.values.isEmpty)
    _ = try await transport.send(APIClient.authorized(url: url, method: .get, token: "token"))
    #expect(expired.values == ["expired"])
}

@Test func bridgeFlagsSessionExpiryOnFourOhOne() async throws {
    let error = ClientHTTPError(status: 401, message: "Unauthorized")
    let encoded = RuntimeCall.failureJSON(error)
    let object = try #require(try JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: Any])
    #expect(flag(object, "ok") == false)
    #expect(flag(object, "sessionExpired"))
    let other = try #require(try JSONSerialization.jsonObject(with: Data(RuntimeCall.failureJSON(ClientHTTPError(status: 500, message: "x")).utf8)) as? [String: Any])
    #expect(flag(other, "sessionExpired") == false)
}

// MARK: 5. Athlete owns the plan of record

@Test func planTriggersFollowTheAuthorityMatrix() {
    #expect(PlanAuthority.allows(role: "athlete", trigger: .auto, hasPlanOfRecord: true))
    #expect(!PlanAuthority.allows(role: "crew_chief", trigger: .auto, hasPlanOfRecord: false))
    #expect(!PlanAuthority.allows(role: "team_manager", trigger: .auto, hasPlanOfRecord: true))
    #expect(PlanAuthority.allows(role: "crew_chief", trigger: .coldStart, hasPlanOfRecord: false))
    #expect(!PlanAuthority.allows(role: "crew_chief", trigger: .coldStart, hasPlanOfRecord: true))
    #expect(PlanAuthority.allows(role: "crew_chief", trigger: .recalculate, hasPlanOfRecord: true))
    #expect(!PlanAuthority.allows(role: "spectator", trigger: .recalculate, hasPlanOfRecord: true))
}

@Test func crewAutoRecomputeNeverReachesTheServer() async throws {
    let transport = EstimateTransport()
    let graph = graph(transport: transport, outbox: nil)
    await #expect(throws: PlanAuthorityError.self) {
        _ = try await PlanOfRecord.recompute(graph: graph, roomId: "room", role: "crew_chief", trigger: .auto, hasPlanOfRecord: true)
    }
    #expect(await transport.bodies().isEmpty)

    _ = try await PlanOfRecord.recompute(graph: graph, roomId: "room", role: "crew_chief", trigger: .recalculate, hasPlanOfRecord: true)
    let bodies = await transport.bodies()
    #expect(bodies.count == 2)
    #expect(bodies.allSatisfy { $0.contains(#""trigger":"recalculate""#) })
}

@Test func bridgeComputeEstimateRequiresAnExplicitCrewTrigger() async throws {
    let refused = try await runtime([
        "op": "computeEstimate",
        "baseURL": "https://example.invalid",
        "role": "crew_chief",
        "roomId": "room"
    ])
    #expect(flag(refused, "ok") == false)
    #expect((refused["message"] as? String) == PlanAuthorityError.notAllowed.message)
}

// MARK: 6. Ping upload rules

@Test func pingRecordedAtMustIncreasePastWhatAlreadyFlushed() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    _ = try await store.enqueuePing(roomId: "room", role: "athlete", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:10:00.000Z")
    _ = try await store.flush { _ in
        OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
    }
    #expect(try await store.operations().isEmpty)
    let older = try await store.enqueuePing(roomId: "room", role: "athlete", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:09:00.000Z")
    #expect(older == .rejected("recordedAt must increase."))
    let same = try await store.enqueuePing(roomId: "room", role: "athlete", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:10:00.000Z")
    #expect(same == .rejected("recordedAt must increase."))
    let otherRoom = try await store.enqueuePing(roomId: "room-2", role: "athlete", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:09:00.000Z")
    guard case .queued = otherRoom else {
        Issue.record("each room keeps its own recordedAt order")
        return
    }
}

@Test func staleRecordedAtIsDroppedNotRetried() async throws {
    let store = try OutboxStore.shared(userId: "athlete-1", directory: temporaryDirectory())
    _ = try await store.enqueuePing(roomId: "room", role: "athlete", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:10:00.000Z")
    let transport = ScriptedTransport(
        status: 422,
        body: #"{"decision":"rejected","reason":"stale_recorded_at","message":"recordedAt must be after the last accepted ping"}"#
    )
    let flushGraph = graph(transport: transport, outbox: store)
    let report = try await RaceDayAPI.flushOutbox(graph: flushGraph)
    #expect(report.dropped.count == 1)
    #expect(try await store.operations().isEmpty)
    _ = try await RaceDayAPI.flushOutbox(graph: flushGraph)
    #expect(await transport.requestCount() == 1)
}

@Test func flushNeverUploadsAPingQueuedByANonAthlete() async throws {
    let directory = temporaryDirectory()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    // A queue written by an older build that let a crew session queue a ping.
    let legacy = #"[{"id":"ping-1","type":"ping","status":"pending","conflictKey":"ping:room","roomId":"room","payloadJSON":"{}","idempotencyKey":"k","clientMessageId":"ping-1","role":"crew_member","recordedAt":"2026-08-15T14:10:00.000Z"}]"#
    try Data(legacy.utf8).write(to: directory.appendingPathComponent("outbox.json"))
    let store = try OutboxStore.shared(userId: "crew-1", directory: directory)
    let transport = ScriptedTransport(status: 200, body: "{}")
    let report = try await RaceDayAPI.flushOutbox(graph: graph(transport: transport, outbox: store))
    #expect(report.dropped == ["ping-1"])
    #expect(await transport.requestCount() == 0)
    #expect(try await store.operations().isEmpty)
}

// MARK: Helpers

private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
}

private func graph(transport: any HTTPTransport, outbox: OutboxStore?) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: StaticTokenProvider(token: "token"),
        outbox: outbox
    )
}

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func resultObject(_ root: [String: Any]) throws -> [String: Any] {
    try #require(root["result"] as? [String: Any], "\(root)")
}

private func flag(_ object: [String: Any], _ key: String) -> Bool {
    if let value = object[key] as? Bool { return value }
    if let value = object[key] as? NSNumber { return value.boolValue }
    return false
}

private func number(_ value: Any?) -> Int? {
    if let number = value as? NSNumber { return number.intValue }
    return value as? Int
}

private struct StreamStyleError: Error, CustomStringConvertible {
    var description: String
}

/// Holds a send open until the test releases it, so other work can interleave.
private actor Gate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    private var arrived = false

    func wait() async {
        arrived = true
        arrivals.forEach { $0.resume() }
        arrivals = []
        guard !isOpen else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func waitUntilWaiting() async {
        guard !arrived else { return }
        await withCheckedContinuation { arrivals.append($0) }
    }

    func open() {
        isOpen = true
        waiters.forEach { $0.resume() }
        waiters = []
    }
}

private actor OperationLog {
    private(set) var operations: [StoredOperation] = []

    func append(_ operation: StoredOperation) {
        operations.append(operation)
    }
}

private actor SendCounter {
    private var sends: [String: Int] = [:]

    func record(_ id: String) {
        sends[id, default: 0] += 1
    }

    func counts() -> [String: Int] {
        sends
    }
}

private final class Flags: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    func set(_ value: String) {
        lock.lock()
        recorded.append(value)
        lock.unlock()
    }

    var values: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recorded.sorted()
    }
}

private actor ScriptedTransport: HTTPTransport {
    private let status: Int
    private let body: String
    private var requests = 0

    init(status: Int, body: String) {
        self.status = status
        self.body = body
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests += 1
        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func requestCount() -> Int {
        requests
    }
}

private actor EstimateTransport: HTTPTransport {
    private var captured: [String] = []

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        captured.append(String(decoding: request.body ?? Data(), as: UTF8.self))
        let estimate = #"{"id":"est-1","coldStart":false,"expectedFinishAt":"2026-08-15T14:00:00.000Z","expectedFinishElapsedSeconds":3600,"aidEtas":[],"explanation":"From history.","historyRefIds":[]}"#
        if request.method == .put {
            return HTTPResponse(status: 200, body: Data(#"{"roomId":"room","pacingEstimateId":"est-1","estimate":\#(estimate)}"#.utf8))
        }
        return HTTPResponse(status: 200, body: Data(estimate.utf8))
    }

    func bodies() -> [String] {
        captured
    }
}
