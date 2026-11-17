import Foundation
import Testing
@testable import CrewCueClientCore

// MARK: - Fixtures

private let t0 = Date(timeIntervalSince1970: 1_790_000_000.123_4)
private let day: TimeInterval = 24 * 60 * 60

private func stores() -> (onboarding: OnboardingStore, pending: PendingJoinStore, storageRoot: URL) {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("pending-join-\(UUID().uuidString)", isDirectory: true)
    let root = base.appendingPathComponent("crewcue", isDirectory: true)
    let onboarding = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: root))
    return (onboarding, onboarding.pendingJoins, root)
}

private struct FixedClock: Clock {
    let date: Date
    func now() -> Date { date }
}

private func roomJSON(_ id: String) -> [String: Any] {
    [
        "id": id, "teamId": "team-1", "athleteId": "runner-1", "name": "Western States", "status": "active",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "memberships": [["userId": "runner-1", "role": "athlete", "joinedAt": "2026-08-01T00:00:00.000Z"]],
        "entitlement": ["status": "paid", "lastUpdatedAt": "2026-08-01T00:00:00.000Z", "source": "store"]
    ]
}

private func json(_ object: Any) -> Data {
    (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
}

/// What the server answers for `GET /race-rooms/mine` and `POST /race-rooms/join-by-code`, as
/// `services/api/src/routes/raceRooms.ts` and `billingEntitlement.ts` send them.
private indirect enum Reply: Sendable {
    case status(Int, Data)
    case offline
    /// Runs `hold`, then answers `then`.
    case wait(@Sendable () async -> Void, then: Reply)

    static func rooms(_ ids: [String]) -> Reply { .status(200, json(["rooms": ids.map(roomJSON)])) }
    static func joined(_ id: String) -> Reply {
        .status(200, json(["room": roomJSON(id), "assignedRole": "crew_member", "permissions": ["chat"]]))
    }
    static let notFound = Reply.status(404, json(["error": "Race room not found"]))
    static let badPayload = Reply.status(400, json(["error": "Invalid room join payload"]))
    static let unauthorized = Reply.status(401, json(["error": "Unauthorized"]))
    static let unpaid = Reply.status(402, json(["error": "Race not unlocked", "code": "room_unpaid"]))
    static let full = Reply.status(409, json([
        "error": "Crew limit reached", "code": "crew_limit_reached", "roomId": "r9",
        "crewLimit": 1, "crewCount": 1, "upgradeProductId": "crew_upgrade"
    ]))
    static let rateLimited = Reply.status(429, json(["error": "Too many requests"]))
    static let serverError = Reply.status(500, json(["error": "Internal Server Error"]))
}

private struct Sent: Sendable {
    var method: String
    var path: String
    var authorization: String?
    var body: String?
}

private actor JoinServer: HTTPTransport {
    private let mine: Reply
    private let join: Reply
    private(set) var sent: [Sent] = []

    init(mine: Reply = .rooms([]), join: Reply) {
        self.mine = mine
        self.join = join
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        sent.append(Sent(
            method: request.method.rawValue, path: request.url.path,
            authorization: request.headers["Authorization"],
            body: request.body.map { String(decoding: $0, as: UTF8.self) }
        ))
        switch (request.method, request.url.path) {
        case (.get, "/race-rooms/mine"): return try await answer(mine)
        case (.post, "/race-rooms/join-by-code"): return try await answer(join)
        default: return HTTPResponse(status: 404, body: json(["error": "Not found"]))
        }
    }

    private func answer(_ reply: Reply) async throws -> HTTPResponse {
        switch reply {
        case .status(let status, let body): return HTTPResponse(status: status, body: body)
        case .offline: throw URLError(.notConnectedToInternet)
        case .wait(let hold, let then):
            await hold()
            return try await answer(then)
        }
    }

    var paths: [String] { sent.map { "\($0.method) \($0.path)" } }
}

private func graph(_ transport: any HTTPTransport, token: String? = "jwt", now: Date = t0.addingTimeInterval(60)) -> ClientGraph {
    ClientGraph(
        transport: transport, clock: FixedClock(date: now), logger: SilentLogger(),
        baseURL: URL(string: "https://api.example.test"), tokenProvider: StaticTokenProvider(token: token)
    )
}

/// Resolves `join` for a saved code and answers the outcome and what the store kept.
private func resolve(mine: Reply = .rooms([]), join: Reply, token: String? = "jwt") async throws -> (PendingJoinOutcome, PendingJoin?, JoinServer) {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, now: t0)
    let server = JoinServer(mine: mine, join: join)
    let outcome = await pending.resolve(graph: graph(server, token: token))
    return (outcome, pending.read(now: t0.addingTimeInterval(120)), server)
}

// MARK: - Store

@Test func pendingJoinStoreSavesReadsAndReplacesOneCode() throws {
    let (onboarding, pending, _) = stores()
    #expect(pending.read(now: t0) == nil)
    let saved = try pending.save(code: " 123456 ", source: .link, now: t0)
    #expect(saved.code == "123456" && saved.source == .link)
    #expect(pending.read(now: t0.addingTimeInterval(60)) == saved)
    #expect(saved.expiresAt == saved.savedAt.addingTimeInterval(7 * day))
    // Beside the progress files, under a name no user id can take.
    #expect(pending.file.deletingLastPathComponent().standardizedFileURL == onboarding.directory.standardizedFileURL)
    #expect(pending.file.lastPathComponent == "@pending-join.json")
    for userId in ["@pending-join", "pending-join", "@pending-join.json", ""] {
        #expect(onboarding.file(userId: userId) != pending.file, "\(userId)")
    }

    // One pending code: a later save replaces it, source included.
    let typed = try pending.save(code: "654321", source: .typed, now: t0.addingTimeInterval(10))
    #expect(pending.read(now: t0.addingTimeInterval(60)) == typed)
    let referred = try pending.save(code: "111111", source: .referrer, now: t0.addingTimeInterval(20))
    #expect(pending.read(now: t0.addingTimeInterval(60))?.source == .referrer)
    #expect(pending.read(now: t0.addingTimeInterval(60)) == referred)

    // A code that isn't six ASCII digits is refused and leaves the saved one alone.
    for bad in ["12345", "1234567", "abcdef", "１２３４５６", ""] {
        #expect(throws: PendingJoinError.invalidCode) { try pending.save(code: bad, source: .typed, now: t0) }
    }
    #expect(pending.read(now: t0.addingTimeInterval(60)) == referred)
}

@Test func pendingJoinExpiresAfterSevenDays() throws {
    let (_, pending, _) = stores()
    let saved = try pending.save(code: "123456", source: .link, now: t0)
    #expect(pending.read(now: saved.savedAt.addingTimeInterval(7 * day - 1)) == saved)
    #expect(pending.read(now: saved.savedAt.addingTimeInterval(7 * day)) == nil)
    // Expired is gone, not hidden: an earlier clock doesn't bring it back.
    #expect(!FileManager.default.fileExists(atPath: pending.file.path))
    #expect(pending.read(now: t0) == nil)

    // A save stamped far ahead (the clock moved back since) expires as well.
    let ahead = try pending.save(code: "123456", source: .link, now: t0)
    #expect(pending.read(now: ahead.savedAt.addingTimeInterval(-7 * day + 1)) != nil)
    #expect(pending.read(now: ahead.savedAt.addingTimeInterval(-7 * day)) == nil)
}

@Test func pendingJoinClearsAndDropsAnUnreadableFile() throws {
    let (_, pending, _) = stores()
    try pending.clear()
    try pending.save(code: "123456", source: .link, now: t0)
    try pending.clear()
    #expect(pending.read(now: t0) == nil)
    #expect(!FileManager.default.fileExists(atPath: pending.file.path))

    for body in [Data("not json".utf8), json(["code": "12345", "source": "link", "savedAtMs": 1]),
                 json(["code": "123456", "source": "email", "savedAtMs": 1]), json(["code": "123456", "source": "link"])] {
        try FileManager.default.createDirectory(at: pending.directory, withIntermediateDirectories: true)
        try body.write(to: pending.file)
        #expect(pending.read(now: t0) == nil)
        #expect(!FileManager.default.fileExists(atPath: pending.file.path))
    }
}

@Test func pendingJoinSurvivesSignOutAndSignIn() async throws {
    let (onboarding, pending, root) = stores()
    let saved = try pending.save(code: "123456", source: .link, now: t0)
    try Data("{}".utf8).write(to: try UserStorage(root: root).directory(userId: "ada").appendingPathComponent("outbox.json"))

    // iOS sign-out wipes every user; Android deletes the whole storage root.
    try UserStorage(root: root).wipeAll()
    try FileManager.default.removeItem(at: root)
    // Sign-in: `adoptUser` clears the root but that user's directory; progress files stay.
    try FileManager.default.createDirectory(at: root.appendingPathComponent("stale"), withIntermediateDirectories: true)
    let adopted = await RuntimeCall.perform(#"{"op":"adoptUser","storageDir":"\#(root.path)","userId":"bo"}"#)
    #expect(adopted.contains(#""ok":true"#))
    #expect(pending.read(now: t0.addingTimeInterval(60)) == saved)
    // Resetting or deleting an account's progress never takes the device's pending code.
    try onboarding.reset(userId: "bo")
    try onboarding.reset(userId: nil)
    try onboarding.removeUser("bo")
    _ = try onboarding.adoptGuest(userId: "bo")
    #expect(pending.read(now: t0.addingTimeInterval(60)) == saved)
}

@Test func pendingJoinSavedSignedOutIsJoinedByWhoeverSignsInNext() async throws {
    let (onboarding, pending, _) = stores()
    try pending.save(code: "123456", source: .link, now: t0)

    // Signed out: the crew join, and confirming it counts for this code.
    var read = try onboarding.read(signedIn: false, userId: nil, now: t0)
    #expect(read.state.flow == .crew && read.state.step == .join)
    #expect(read.pendingJoin?.code == "123456")
    try onboarding.mark(.join, invite: "123456", userId: nil)
    read = try onboarding.read(signedIn: false, userId: nil, now: t0)
    #expect(read.state.step == .account)
    #expect(read.state.inviteConfirmed)

    // Bo signs in on this device: the same code is Bo's to accept.
    read = try onboarding.read(signedIn: true, userId: "bo", races: [], now: t0)
    #expect(read.state.flow == .crew && read.state.step == .join && read.state.status(.account)?.isComplete == true)
    let server = JoinServer(join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(server)) == .joined(roomId: "r9"))
    let sent = await server.sent
    #expect(sent.last?.authorization == "Bearer jwt")
    #expect(sent.last?.body == #"{"roomCode":"123456"}"#)

    // Joined: no invite left for Bo, or for whoever signs in next.
    let crewRace = OnboardingRace(roomId: "r9", role: "crew_member", entitlementStatus: "paid", hasCourse: true)
    read = try onboarding.read(signedIn: true, userId: "bo", races: [crewRace], now: t0)
    #expect(read.pendingJoin == nil)
    #expect(read.state.flow == .crew && read.state.roomId == "r9" && read.state.phase == .tour)
    #expect(try onboarding.read(signedIn: true, userId: "cy", races: [], now: t0).state.flow == .chooser)
}

// MARK: - Resolve

@Test func pendingJoinResolveMapsEveryServerAnswer() async throws {
    var (outcome, kept, server) = try await resolve(join: .joined("r9"))
    #expect(outcome == .joined(roomId: "r9") && kept == nil)
    #expect(await server.paths == ["GET /race-rooms/mine", "POST /race-rooms/join-by-code"])

    // The server answers a member and a newcomer alike: the race list tells them apart.
    (outcome, kept, _) = try await resolve(mine: .rooms(["r1", "r9"]), join: .joined("r9"))
    #expect(outcome == .alreadyMember(roomId: "r9") && kept == nil)
    (outcome, kept, _) = try await resolve(mine: .rooms(["r1"]), join: .joined("r9"))
    #expect(outcome == .joined(roomId: "r9"))

    (outcome, kept, _) = try await resolve(join: .full)
    #expect(outcome == .raceFull && kept?.code == "123456")
    #expect(outcome.message == "This race is full. Ask the runner to upgrade their pass.")

    (outcome, kept, _) = try await resolve(join: .unpaid)
    #expect(outcome == .raceLocked && kept?.code == "123456")
    #expect(outcome.message == "The runner hasn't unlocked this race yet.")
    #expect(outcome.message == OnboardingState.raceLockedReason)

    (outcome, kept, _) = try await resolve(join: .notFound)
    #expect(outcome == .invalidCode && kept == nil)
    (outcome, kept, _) = try await resolve(join: .badPayload)
    #expect(outcome == .invalidCode && kept == nil)

    (outcome, kept, _) = try await resolve(join: .offline)
    #expect(outcome == .offline && kept?.code == "123456")
    (outcome, kept, server) = try await resolve(mine: .offline, join: .joined("r9"))
    #expect(outcome == .offline && kept?.code == "123456")
    #expect(await server.paths == ["GET /race-rooms/mine"])

    // 401 on either request is a signed-out user; the code waits for the next sign-in.
    (outcome, kept, server) = try await resolve(mine: .unauthorized, join: .joined("r9"))
    #expect(outcome == .signedOut && kept?.code == "123456")
    #expect(await server.paths == ["GET /race-rooms/mine"])
    (outcome, kept, _) = try await resolve(join: .unauthorized)
    #expect(outcome == .signedOut && kept?.code == "123456")

    for reply in [Reply.serverError, .rateLimited, .status(200, Data("{}".utf8)),
                  .status(402, json(["error": "Payment required"])), .status(409, json(["error": "Conflict"])),
                  .status(403, json(["error": "Forbidden"]))] {
        (outcome, kept, _) = try await resolve(join: reply)
        #expect(outcome == .failed && kept?.code == "123456")
    }

    // The race list failing for another reason only loses the member check.
    (outcome, kept, _) = try await resolve(mine: .serverError, join: .joined("r9"))
    #expect(outcome == .joined(roomId: "r9") && kept == nil)
}

@Test func pendingJoinResolveNeedsASessionAndACode() async throws {
    for token in [nil, "", "  "] as [String?] {
        let (outcome, kept, server) = try await resolve(join: .joined("r9"), token: token)
        #expect(outcome == .signedOut && kept?.code == "123456")
        #expect(await server.sent.isEmpty)
    }

    let (_, pending, _) = stores()
    let server = JoinServer(join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(server)) == .nothingPending)
    // Expired by the graph's clock: forgotten, never sent.
    try pending.save(code: "123456", source: .link, now: t0)
    #expect(await pending.resolve(graph: graph(server, now: t0.addingTimeInterval(8 * day))) == .nothingPending)
    #expect(await server.sent.isEmpty)
    #expect(!FileManager.default.fileExists(atPath: pending.file.path))
}

@Test func pendingJoinOutcomesSayWhatHappenedAndWhetherTheCodeStays() {
    let all: [PendingJoinOutcome] = [
        .joined(roomId: "r9"), .alreadyMember(roomId: "r9"), .raceFull, .raceLocked, .invalidCode,
        .offline, .signedOut, .failed, .nothingPending
    ]
    #expect(all.map(\.name) == [
        "joined", "alreadyMember", "raceFull", "raceLocked", "invalidCode", "offline", "signedOut", "failed", "nothingPending"
    ])
    #expect(all.filter(\.clearsCode).map(\.name) == ["joined", "alreadyMember", "invalidCode"])
    #expect(all.compactMap(\.roomId) == ["r9", "r9"])
    #expect(all.filter { $0.message == nil }.map(\.name) == ["joined", "nothingPending"])
    #expect(PendingJoinOutcome.offline.message == "Offline. Joining a race needs the network.")
    #expect(PendingJoinOutcome.invalidCode.message == "That invite code was not found.")

    #expect(PendingJoinOutcome.outcome(for: URLError(.timedOut)) == .offline)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 0, message: "API base URL is not set.")) == .offline)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 402, message: "x", reason: "room_unpaid")) == .raceLocked)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 409, message: "x", decision: "crew_limit_reached")) == .raceFull)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 409, message: "x", reason: "room_unpaid")) == .failed)
    #expect(PendingJoinOutcome.outcome(for: DemoRaceError.ended) == .failed)
}

private actor Gate {
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var open = false

    func wait() async {
        if open { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        open = true
        waiters.forEach { $0.resume() }
        waiters = []
    }
}

@Test func pendingJoinResolveGivesUpAtTheDeadlineAndKeepsTheCode() async throws {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, now: t0)
    let gate = Gate()
    let server = JoinServer(join: .wait({ await gate.wait() }, then: .joined("r9")))
    let outcome = await pending.resolve(graph: graph(server), deadlineSeconds: 0.2)
    #expect(outcome == .offline)
    #expect(pending.read(now: t0)?.code == "123456")
    #expect(await server.paths == ["GET /race-rooms/mine", "POST /race-rooms/join-by-code"])

    // The abandoned join lands later: nothing clears the code behind the caller's back.
    await gate.release()
    try await Task.sleep(nanoseconds: 150_000_000)
    #expect(pending.read(now: t0)?.code == "123456")
}

@Test func pendingJoinResolveNeverSendsTheJoinAfterTheRaceListTimedOut() async throws {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, now: t0)
    let gate = Gate()
    let server = JoinServer(mine: .wait({ await gate.wait() }, then: .rooms([])), join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(server), deadlineSeconds: 0.2) == .offline)

    // The abandoned read answers later; the caller already heard `offline`, so no join follows.
    await gate.release()
    try await Task.sleep(nanoseconds: 150_000_000)
    #expect(await server.paths == ["GET /race-rooms/mine"])
    #expect(pending.read(now: t0)?.code == "123456")
}

@Test func pendingJoinResolveNeverClearsACodeSavedWhileItRan() async throws {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, now: t0)
    // A second link opens while the first join is in flight.
    let server = JoinServer(join: .wait({ _ = try? pending.save(code: "654321", source: .link, now: t0.addingTimeInterval(5)) }, then: .joined("r9")))
    #expect(await pending.resolve(graph: graph(server)) == .joined(roomId: "r9"))
    #expect(pending.read(now: t0.addingTimeInterval(60))?.code == "654321")
}

// MARK: - Onboarding

@Test func readOnboardingTakesThePendingInviteFromTheStore() throws {
    let (onboarding, pending, _) = stores()
    #expect(try onboarding.read(signedIn: false, userId: nil, now: t0).state == .chooser)
    try pending.save(code: "123456", source: .referrer, now: t0)

    var read = try onboarding.read(signedIn: false, userId: nil, now: t0.addingTimeInterval(60))
    #expect(read.state.flow == .crew && read.state.phase == .join && read.state.step == .join)
    #expect(read.pendingJoin?.code == "123456" && read.pendingJoin?.source == .referrer)
    // A signed-in user's own race stays under the join.
    let race = OnboardingRace(roomId: "r1", role: "athlete", entitlementStatus: "paid", hasCourse: true)
    read = try onboarding.read(signedIn: true, userId: "ada", races: [race], activeRoomId: "r1", now: t0)
    #expect(read.state.flow == .crew && read.state.step == .join && read.state.showsTabBar)

    // A named invite wins over the saved one: confirming the saved code doesn't confirm it.
    try onboarding.mark(.join, invite: "123456", userId: nil)
    read = try onboarding.read(signedIn: false, userId: nil, pendingInvite: "tok-b", now: t0)
    #expect(read.state.step == .join && !read.state.inviteConfirmed)
    #expect(try onboarding.read(signedIn: false, userId: nil, now: t0).state.inviteConfirmed)

    // Expired: no invite.
    read = try onboarding.read(signedIn: false, userId: nil, now: t0.addingTimeInterval(8 * day))
    #expect(read.pendingJoin == nil && read.state.flow == .chooser)
}

// MARK: - Runtime ops

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func result(_ root: [String: Any]) throws -> [String: Any] {
    #expect(root["ok"] as? Bool == true, "\(root["message"] ?? "")")
    return try #require(root["result"] as? [String: Any])
}

@Test func inviteRuntimeOpsRoundTrip() async throws {
    let parsed = try result(try await runtime(["op": "parseInviteLink", "link": "https://collinbrowse.github.io/crewcue/join/?code=123456"]))
    #expect(parsed["code"] as? String == "123456" && parsed["source"] as? String == "link")
    let app = try result(try await runtime(["op": "parseInviteLink", "link": "crewcue://join/234567"]))
    #expect(app["code"] as? String == "234567" && app["source"] as? String == "link")
    let referrer = try result(try await runtime(["op": "parseInviteLink", "link": "utm_source=google-play&crewcue_join%3D345678"]))
    #expect(referrer["code"] as? String == "345678" && referrer["source"] as? String == "referrer")
    for link in ["https://collinbrowse.github.io.evil.com/crewcue/join/?code=123456", "123456", ""] {
        let none = try result(try await runtime(["op": "parseInviteLink", "link": link]))
        #expect(none["code"] is NSNull && none["source"] is NSNull)
    }
    #expect(try result(try await runtime(["op": "parseInviteLink"]))["code"] is NSNull)

    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("invite-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let device: [String: Any] = ["storageDir": storage, "userId": "", "token": ""]
    #expect(try result(try await runtime(device.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)

    let saved = try result(try await runtime(device.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
    let row = try #require(saved["pendingJoin"] as? [String: Any])
    #expect(row["code"] as? String == "123456" && row["source"] as? String == "link")
    let savedAt = try #require((row["savedAt"] as? String).flatMap(isoDate))
    let expiresAt = try #require((row["expiresAt"] as? String).flatMap(isoDate))
    #expect(abs(expiresAt.timeIntervalSince(savedAt) - 7 * day) < 0.001)
    let read = try result(try await runtime(device.merging(["op": "readPendingJoin"]) { $1 }))
    #expect((read["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    // The Swift store reads the op's file: one store for both apps.
    let swift = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: storage, isDirectory: true)))
    #expect(swift.pendingJoins.read(now: Date())?.code == "123456")

    let typed = try result(try await runtime(device.merging(["op": "savePendingJoin", "code": "654321"]) { $1 }))
    #expect((typed["pendingJoin"] as? [String: Any])?["source"] as? String == "typed")
    let bad = try await runtime(device.merging(["op": "savePendingJoin", "code": "12345"]) { $1 })
    #expect(bad["ok"] as? Bool == false && bad["message"] as? String == PendingJoinError.invalidCode.message)
    let unknown = try await runtime(device.merging(["op": "savePendingJoin", "code": "123456", "source": "email"]) { $1 })
    #expect(unknown["ok"] as? Bool == false)
    #expect(swift.pendingJoins.read(now: Date())?.code == "654321")

    let cleared = try result(try await runtime(device.merging(["op": "clearPendingJoin"]) { $1 }))
    #expect(cleared["pendingJoin"] is NSNull)
    #expect(try result(try await runtime(device.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)

    // An explicit onboardingDir wins over storageDir.
    let elsewhere = FileManager.default.temporaryDirectory.appendingPathComponent("invite-rt-\(UUID().uuidString)", isDirectory: true)
    _ = try result(try await runtime(["op": "savePendingJoin", "code": "123456", "onboardingDir": elsewhere.path]))
    #expect(PendingJoinStore(directory: elsewhere).read(now: Date())?.code == "123456")
}

private func isoDate(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text)
}

@Test func resolvePendingJoinRuntimeOpJoinsAndReportsTheOutcome() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("invite-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let joining = "https://join-\(UUID().uuidString.lowercased()).example.invalid"
    let full = "https://full-\(UUID().uuidString.lowercased()).example.invalid"
    let expired = "https://expired-\(UUID().uuidString.lowercased()).example.invalid"
    let server = JoinServer(join: .joined("r9"))
    RuntimeCall.setTransportForTests(server, baseURL: joining)
    RuntimeCall.setTransportForTests(JoinServer(join: .full), baseURL: full)
    RuntimeCall.setTransportForTests(JoinServer(mine: .unauthorized, join: .joined("r9")), baseURL: expired)
    defer {
        for base in [joining, full, expired] { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    }
    let ada: [String: Any] = ["storageDir": storage, "userId": "ada", "token": "jwt"]

    let nothing = try result(try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": joining]) { $1 }))
    #expect(nothing["outcome"] as? String == "nothingPending" && nothing["clearsCode"] as? Bool == false)
    #expect(nothing["roomId"] is NSNull && nothing["message"] is NSNull)

    _ = try result(try await runtime(ada.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
    // Signed out on this device: kept, nothing sent.
    let signedOut = try result(try await runtime([
        "op": "resolvePendingJoin", "baseURL": joining, "storageDir": storage, "userId": "", "token": ""
    ]))
    #expect(signedOut["outcome"] as? String == "signedOut")
    #expect(signedOut["message"] as? String == PendingJoinOutcome.signedOutMessage)
    #expect((signedOut["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")

    // A full race: the message, and the code kept for a retry.
    let refused = try result(try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": full]) { $1 }))
    #expect(refused["outcome"] as? String == "raceFull" && refused["clearsCode"] as? Bool == false)
    #expect(refused["message"] as? String == PendingJoinOutcome.raceFullMessage)
    #expect((refused["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")

    // The server refusing the session fails like every op's 401, so the app signs out; the code stays.
    let rejected = try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": expired]) { $1 })
    #expect(rejected["ok"] as? Bool == false && rejected["sessionExpired"] as? Bool == true)
    #expect(rejected["message"] as? String == PendingJoinOutcome.signedOutMessage)

    // A replay never joins: refused before any request, the code kept.
    let demo = try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": "https://r1.\(DemoRace.host)"]) { $1 })
    #expect(demo["ok"] as? Bool == false)
    #expect(demo["message"] as? String == DemoRaceError.readOnly("the replay never joins a race").message)

    let joined = try result(try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": joining]) { $1 }))
    #expect(joined["outcome"] as? String == "joined" && joined["roomId"] as? String == "r9")
    #expect(joined["clearsCode"] as? Bool == true && joined["pendingJoin"] is NSNull)
    #expect(await server.sent.last?.authorization == "Bearer jwt")
    #expect(try result(try await runtime(ada.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)
}

@Test func readOnboardingRuntimeOpTakesThePendingInviteFromTheStore() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("invite-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let signedOut: [String: Any] = ["storageDir": storage, "userId": "", "token": ""]
    func state(_ fields: [String: Any]) async throws -> [String: Any] {
        try #require(try result(try await runtime(signedOut.merging(fields) { $1 }))["state"] as? [String: Any])
    }

    #expect(try await state(["op": "readOnboarding"])["flow"] as? String == "chooser")
    _ = try result(try await runtime(signedOut.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))

    let read = try result(try await runtime(signedOut.merging(["op": "readOnboarding"]) { $1 }))
    #expect((read["state"] as? [String: Any])?["flow"] as? String == "crew")
    #expect((read["state"] as? [String: Any])?["step"] as? String == "join")
    #expect((read["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    // The caller's own answer wins: false is no invite, true is the saved code.
    #expect(try await state(["op": "readOnboarding", "hasPendingInvite": false])["flow"] as? String == "chooser")
    #expect(try await state(["op": "readOnboarding", "hasPendingInvite": true])["step"] as? String == "join")

    // Confirming the saved code signed out moves on to sign-in, for this code only.
    let marked = try await state(["op": "markOnboardingStep", "step": "join", "invite": "123456"])
    #expect(marked["step"] as? String == "account" && marked["inviteConfirmed"] as? Bool == true)
    #expect(try await state(["op": "readOnboarding"])["inviteConfirmed"] as? Bool == true)
    #expect(try await state(["op": "readOnboarding", "hasPendingInvite": true])["inviteConfirmed"] as? Bool == true)
    #expect(try await state(["op": "readOnboarding", "pendingInvite": "654321"])["inviteConfirmed"] as? Bool == false)

    // Saved more than 7 days ago: expired, so no invite.
    let store = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: storage, isDirectory: true)))
    try store.pendingJoins.save(code: "123456", source: .link, now: Date().addingTimeInterval(-8 * day))
    let stale = try result(try await runtime(signedOut.merging(["op": "readOnboarding"]) { $1 }))
    #expect(stale["pendingJoin"] is NSNull)
    #expect((stale["state"] as? [String: Any])?["flow"] as? String == "chooser")
}
