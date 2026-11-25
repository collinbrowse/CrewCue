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

/// Resolves `join` as Ada for a code Ada saved and answers the outcome and what the store kept
/// for her.
private func resolve(mine: Reply = .rooms([]), join: Reply, token: String? = "jwt") async throws -> (PendingJoinOutcome, PendingJoin?, JoinServer) {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: "ada", now: t0)
    let server = JoinServer(mine: mine, join: join)
    let outcome = await pending.resolve(graph: graph(server, token: token), userId: "ada")
    return (outcome, pending.read(userId: "ada", now: t0.addingTimeInterval(120)), server)
}

// MARK: - Store

@Test func pendingJoinStoreSavesReadsAndReplacesOneCode() throws {
    let (onboarding, pending, _) = stores()
    #expect(pending.read(userId: nil, now: t0) == nil)
    let saved = try pending.save(code: " 123456 ", source: .link, userId: nil, now: t0)
    #expect(saved.code == "123456" && saved.source == .link)
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60)) == saved)
    #expect(saved.expiresAt == saved.savedAt.addingTimeInterval(7 * day))
    // Beside the progress files, under a name no user id can take.
    #expect(pending.file.deletingLastPathComponent().standardizedFileURL == onboarding.directory.standardizedFileURL)
    #expect(pending.file.lastPathComponent == "@pending-join.json")
    for userId in ["@pending-join", "pending-join", "@pending-join.json", ""] {
        #expect(onboarding.file(userId: userId) != pending.file, "\(userId)")
    }

    // One pending code: a later save replaces it, source included.
    let typed = try pending.save(code: "654321", source: .typed, userId: nil, now: t0.addingTimeInterval(10))
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60)) == typed)
    let referred = try pending.save(code: "111111", source: .referrer, userId: nil, now: t0.addingTimeInterval(20))
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60))?.source == .referrer)
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60)) == referred)

    // A code that isn't six ASCII digits is refused and leaves the saved one alone.
    for bad in ["12345", "1234567", "abcdef", "１２３４５６", ""] {
        #expect(throws: PendingJoinError.invalidCode) { try pending.save(code: bad, source: .typed, userId: nil, now: t0) }
    }
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60)) == referred)
}

@Test func pendingJoinExpiresAfterSevenDays() throws {
    let (_, pending, _) = stores()
    let saved = try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    #expect(pending.read(userId: nil, now: saved.savedAt.addingTimeInterval(7 * day - 1)) == saved)
    #expect(pending.read(userId: nil, now: saved.savedAt.addingTimeInterval(7 * day)) == nil)
    // Expired is gone, not hidden: an earlier clock doesn't bring it back.
    #expect(!FileManager.default.fileExists(atPath: pending.file.path))
    #expect(pending.read(userId: nil, now: t0) == nil)

    // A save stamped far ahead (the clock moved back since) expires as well.
    let ahead = try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    #expect(pending.read(userId: nil, now: ahead.savedAt.addingTimeInterval(-7 * day + 1)) != nil)
    #expect(pending.read(userId: nil, now: ahead.savedAt.addingTimeInterval(-7 * day)) == nil)
}

@Test func pendingJoinClearsAndDropsAnUnreadableFile() throws {
    let (_, pending, _) = stores()
    try pending.clear()
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    try pending.clear()
    #expect(pending.read(userId: nil, now: t0) == nil)
    #expect(!FileManager.default.fileExists(atPath: pending.file.path))

    // Read but not a valid record: removed. An owner that isn't a user id makes it invalid, so a
    // damaged owner never turns one account's code into anyone's.
    let fresh = Int64(t0.timeIntervalSince1970 * 1000)
    for body in [Data("not json".utf8), json(["code": "12345", "source": "link", "savedAtMs": 1]),
                 json(["code": "123456", "source": "email", "savedAtMs": 1]), json(["code": "123456", "source": "link"]),
                 json(["code": "123456", "source": "link", "savedAtMs": fresh, "savedBy": 7]),
                 json(["code": "123456", "source": "link", "savedAtMs": fresh, "savedBy": " "]),
                 json(["code": "123456", "source": "link", "savedAtMs": fresh, "savedBy": NSNull()])] {
        try FileManager.default.createDirectory(at: pending.directory, withIntermediateDirectories: true)
        try body.write(to: pending.file)
        #expect(pending.read(userId: nil, now: t0) == nil)
        #expect(!FileManager.default.fileExists(atPath: pending.file.path))
    }
    // The same record with a real owner reads back as that owner's.
    try json(["code": "123456", "source": "link", "savedAtMs": fresh, "savedBy": "ada"]).write(to: pending.file)
    #expect(pending.read(userId: "ada", now: t0)?.savedBy == "ada")
}

@Test func pendingJoinKeepsAFileItCannotRead() throws {
    let (_, pending, _) = stores()
    let saved = try pending.save(code: "123456", source: .link, userId: nil, now: t0)

    // On iOS a protected file can't be read before the first unlock after a reboot. Unreadable is
    // not invalid: the read answers nil and the invite waits.
    let manager = FileManager.default
    try manager.setAttributes([.posixPermissions: 0o000], ofItemAtPath: pending.file.path)
    defer { try? manager.setAttributes([.posixPermissions: 0o644], ofItemAtPath: pending.file.path) }
    if (try? Data(contentsOf: pending.file)) == nil {
        #expect(pending.read(userId: nil, now: t0) == nil)
        #expect(pending.read(userId: "ada", now: t0) == nil)
        #expect(manager.fileExists(atPath: pending.file.path))
    }
    try manager.setAttributes([.posixPermissions: 0o644], ofItemAtPath: pending.file.path)
    #expect(pending.read(userId: nil, now: t0) == saved)

    // The same for any read that fails outright (here the path is a directory).
    try pending.clear()
    try manager.createDirectory(at: pending.file, withIntermediateDirectories: true)
    #expect(pending.read(userId: nil, now: t0) == nil)
    var isDirectory: ObjCBool = false
    #expect(manager.fileExists(atPath: pending.file.path, isDirectory: &isDirectory) && isDirectory.boolValue)
}

@Test func pendingJoinSurvivesSignOutAndSignIn() async throws {
    let (onboarding, pending, root) = stores()
    let saved = try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    try Data("{}".utf8).write(to: try UserStorage(root: root).directory(userId: "ada").appendingPathComponent("outbox.json"))

    // iOS sign-out wipes every user; Android deletes the whole storage root.
    try UserStorage(root: root).wipeAll()
    try FileManager.default.removeItem(at: root)
    // Sign-in: `adoptUser` clears the root but that user's directory; progress files stay.
    try FileManager.default.createDirectory(at: root.appendingPathComponent("stale"), withIntermediateDirectories: true)
    let adopted = await RuntimeCall.perform(#"{"op":"adoptUser","storageDir":"\#(root.path)","userId":"bo"}"#)
    #expect(adopted.contains(#""ok":true"#))
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60)) == saved)
    // Resetting or deleting an account's progress never takes the device's pending code.
    try onboarding.reset(userId: "bo")
    try onboarding.reset(userId: nil)
    try onboarding.removeUser("bo")
    _ = try onboarding.adoptGuest(userId: "bo")
    #expect(pending.read(userId: nil, now: t0.addingTimeInterval(60)) == saved)
}

@Test func pendingJoinSavedSignedOutIsJoinedByWhoeverSignsInNext() async throws {
    let (onboarding, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)

    // Signed out: the crew join, and confirming it counts for this code.
    var read = try onboarding.read(signedIn: false, userId: nil, now: t0)
    #expect(read.state.flow == .crew && read.state.step == .join)
    #expect(read.pendingJoin?.code == "123456")
    try onboarding.mark(.join, invite: "123456", userId: nil, now: t0)
    read = try onboarding.read(signedIn: false, userId: nil, now: t0)
    #expect(read.state.step == .account)
    #expect(read.state.inviteConfirmed)

    // Bo signs in on this device: the same code is Bo's to accept, and now Bo's alone.
    read = try onboarding.read(signedIn: true, userId: "bo", races: [], now: t0)
    #expect(read.state.flow == .crew && read.state.step == .join && read.state.status(.account)?.isComplete == true)
    #expect(read.pendingJoin?.code == "123456" && read.pendingJoin?.savedBy == "bo")
    #expect(pending.read(userId: nil, now: t0) == nil)
    let server = JoinServer(join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(server), userId: "bo") == .joined(roomId: "r9"))
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

@Test func pendingJoinSavedSignedInNeverReachesTheNextUser() async throws {
    let (onboarding, pending, _) = stores()
    // Ada taps a runner's invite while signed in: the code is hers.
    let saved = try pending.save(code: "123456", source: .link, userId: " ada ", now: t0)
    #expect(saved.savedBy == "ada")
    #expect(try onboarding.read(signedIn: true, userId: "ada", races: [], now: t0).state.step == .join)

    // The race is full, so the code stays for a retry.
    let full = JoinServer(join: .full)
    #expect(await pending.resolve(graph: graph(full), userId: "ada") == .raceFull)
    #expect(pending.read(userId: "ada", now: t0)?.code == "123456")

    // Ada signs out (or the server ends her session). Signed out, there is no invite: the next
    // person on this phone isn't sent into Ada's join, and a signed-out resolve sends nothing.
    var read = try onboarding.read(signedIn: false, userId: nil, now: t0)
    #expect(read.pendingJoin == nil && read.state.flow == .chooser)
    #expect(try onboarding.read(signedIn: false, userId: "ada", now: t0).pendingJoin == nil)
    let quiet = JoinServer(join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(quiet), userId: nil) == .nothingPending)
    #expect(await pending.resolve(graph: graph(quiet), userId: "  ") == .nothingPending)
    // Kept for Ada's next sign-in.
    #expect(pending.read(userId: "ada", now: t0)?.code == "123456")

    // Bo signs in on the same phone: no invite, no join sent with Bo's token, and Ada's code is gone.
    let bo = JoinServer(join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(bo), userId: "bo") == .nothingPending)
    #expect(await bo.sent.isEmpty)
    #expect(await quiet.sent.isEmpty)
    #expect(!FileManager.default.fileExists(atPath: pending.file.path))
    #expect(pending.read(userId: "ada", now: t0) == nil)

    // The same through onboarding: Bo's read shows no invite and drops Ada's code.
    try pending.save(code: "123456", source: .link, userId: "ada", now: t0)
    read = try onboarding.read(signedIn: true, userId: "bo", races: [], now: t0)
    #expect(read.pendingJoin == nil && read.state.flow == .chooser)
    #expect(pending.read(userId: "ada", now: t0) == nil)

    // A code saved signed out becomes the first signed-in reader's: Bo's, then never Cy's.
    try pending.save(code: "654321", source: .link, userId: nil, now: t0)
    #expect(await pending.resolve(graph: graph(JoinServer(join: .full)), userId: "bo") == .raceFull)
    #expect(pending.read(userId: "bo", now: t0)?.savedBy == "bo")
    #expect(try onboarding.read(signedIn: true, userId: "cy", races: [], now: t0).pendingJoin == nil)

    // Still joined by whoever signs in next when nobody has read it signed in yet.
    try pending.save(code: "654321", source: .link, userId: nil, now: t0)
    let joining = JoinServer(join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(joining), userId: "bo") == .joined(roomId: "r9"))
    #expect(await joining.sent.last?.body == #"{"roomCode":"654321"}"#)
    #expect(pending.read(userId: "bo", now: t0) == nil)
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
    #expect(outcome.message == "This race is full. Ask the runner to add Full Crew so more crew can join.")

    (outcome, kept, _) = try await resolve(join: .unpaid)
    #expect(outcome == .raceLocked && kept?.code == "123456")
    #expect(outcome.message == "Waiting for the runner to unlock this race.")
    #expect(outcome.message == OnboardingState.raceLockedReason)

    (outcome, kept, _) = try await resolve(join: .notFound)
    #expect(outcome == .invalidCode && kept == nil)
    (outcome, kept, _) = try await resolve(join: .badPayload)
    #expect(outcome == .invalidCode && kept == nil)
    // A 404 or 400 that isn't the route's own answer says nothing about the code: an edge's page
    // while the service is down, Fastify's route-not-found on an older API build.
    for reply in [Reply.status(404, json(["error": "Application not found"])),
                  .status(404, json(["message": "Route POST:/race-rooms/join-by-code not found", "error": "Not Found", "statusCode": 404])),
                  .status(404, Data("<html>Not Found</html>".utf8)), .status(404, Data()),
                  .status(400, json(["error": "Bad Request"])), .status(400, Data("bad".utf8))] {
        (outcome, kept, _) = try await resolve(join: reply)
        #expect(outcome == .failed && kept?.code == "123456")
    }

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
    #expect(await pending.resolve(graph: graph(server), userId: "ada") == .nothingPending)
    // No user id, even with a token: signed out, so a code saved signed out waits and nothing is sent.
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    for userId in [nil, "", "  "] as [String?] {
        #expect(await pending.resolve(graph: graph(server), userId: userId) == .signedOut)
    }
    #expect(pending.read(userId: nil, now: t0)?.savedBy == nil)
    // Expired by the graph's clock: forgotten, never sent.
    #expect(await pending.resolve(graph: graph(server, now: t0.addingTimeInterval(8 * day)), userId: "ada") == .nothingPending)
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
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 404, message: "x", bodyError: "Race room not found")) == .invalidCode)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 404, message: "Race room not found")) == .failed)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 400, message: "x", bodyError: "Invalid room join payload")) == .invalidCode)
    #expect(PendingJoinOutcome.outcome(for: ClientHTTPError(status: 400, message: "x", bodyError: "Race room not found")) == .failed)
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
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    let gate = Gate()
    let server = JoinServer(join: .wait({ await gate.wait() }, then: .joined("r9")))
    let outcome = await pending.resolve(graph: graph(server), userId: "ada", deadlineSeconds: 0.2)
    #expect(outcome == .offline)
    #expect(pending.read(userId: "ada", now: t0)?.code == "123456")
    #expect(await server.paths == ["GET /race-rooms/mine", "POST /race-rooms/join-by-code"])

    // The abandoned join lands later: nothing clears the code behind the caller's back.
    await gate.release()
    try await Task.sleep(nanoseconds: 150_000_000)
    #expect(pending.read(userId: "ada", now: t0)?.code == "123456")
}

@Test func pendingJoinResolveNeverSendsTheJoinAfterTheRaceListTimedOut() async throws {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    let gate = Gate()
    let server = JoinServer(mine: .wait({ await gate.wait() }, then: .rooms([])), join: .joined("r9"))
    #expect(await pending.resolve(graph: graph(server), userId: "ada", deadlineSeconds: 0.2) == .offline)

    // The abandoned read answers later; the caller already heard `offline`, so no join follows.
    await gate.release()
    try await Task.sleep(nanoseconds: 150_000_000)
    #expect(await server.paths == ["GET /race-rooms/mine"])
    #expect(pending.read(userId: "ada", now: t0)?.code == "123456")
}

@Test func pendingJoinResolveNeverClearsACodeSavedWhileItRan() async throws {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    // A second link opens while the first join is in flight.
    let server = JoinServer(join: .wait({ _ = try? pending.save(code: "654321", source: .link, userId: nil, now: t0.addingTimeInterval(5)) }, then: .joined("r9")))
    #expect(await pending.resolve(graph: graph(server), userId: "ada") == .joined(roomId: "r9"))
    #expect(pending.read(userId: "ada", now: t0.addingTimeInterval(60))?.code == "654321")
}

// MARK: - Onboarding

@Test func readOnboardingTakesThePendingInviteFromTheStore() throws {
    let (onboarding, pending, _) = stores()
    #expect(try onboarding.read(signedIn: false, userId: nil, now: t0).state == .chooser)
    try pending.save(code: "123456", source: .referrer, userId: nil, now: t0)

    var read = try onboarding.read(signedIn: false, userId: nil, now: t0.addingTimeInterval(60))
    #expect(read.state.flow == .crew && read.state.phase == .join && read.state.step == .join)
    #expect(read.pendingJoin?.code == "123456" && read.pendingJoin?.source == .referrer)

    // A named invite wins over the saved one: confirming the saved code doesn't confirm it.
    try onboarding.mark(.join, invite: "123456", userId: nil, now: t0)
    read = try onboarding.read(signedIn: false, userId: nil, pendingInvite: "tok-b", now: t0)
    #expect(read.state.step == .join && !read.state.inviteConfirmed)
    #expect(try onboarding.read(signedIn: false, userId: nil, now: t0).state.inviteConfirmed)

    // Expired: no invite.
    read = try onboarding.read(signedIn: false, userId: nil, now: t0.addingTimeInterval(8 * day))
    #expect(read.pendingJoin == nil && read.state.flow == .chooser)

    // Signed in, the code becomes the reader's. A signed-in user's own race stays under the join.
    try pending.save(code: "123456", source: .referrer, userId: nil, now: t0)
    let race = OnboardingRace(roomId: "r1", role: "athlete", entitlementStatus: "paid", hasCourse: true)
    read = try onboarding.read(signedIn: true, userId: "ada", races: [race], activeRoomId: "r1", now: t0)
    #expect(read.state.flow == .crew && read.state.step == .join && read.state.showsTabBar)
    #expect(read.pendingJoin?.savedBy == "ada")
    // Ada's now: not the invite signed out (`signedIn: false` with her id is signed out too) or for Bo.
    #expect(try onboarding.read(signedIn: false, userId: nil, now: t0).pendingJoin == nil)
    #expect(try onboarding.read(signedIn: false, userId: "ada", now: t0).pendingJoin == nil)
    #expect(try onboarding.read(signedIn: true, userId: "ada", now: t0).pendingJoin?.code == "123456")
    read = try onboarding.read(signedIn: true, userId: "bo", races: [race], activeRoomId: "r1", now: t0)
    // Bo's own runner race (an existing account, so its tours count as done), never Ada's join.
    #expect(read.pendingJoin == nil && read.state.role == .runner && read.state.flow != .crew)
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
    #expect(swift.pendingJoins.read(userId: nil, now: Date())?.code == "123456")

    let typed = try result(try await runtime(device.merging(["op": "savePendingJoin", "code": "654321"]) { $1 }))
    #expect((typed["pendingJoin"] as? [String: Any])?["source"] as? String == "typed")
    let bad = try await runtime(device.merging(["op": "savePendingJoin", "code": "12345"]) { $1 })
    #expect(bad["ok"] as? Bool == false && bad["message"] as? String == PendingJoinError.invalidCode.message)
    let unknown = try await runtime(device.merging(["op": "savePendingJoin", "code": "123456", "source": "email"]) { $1 })
    #expect(unknown["ok"] as? Bool == false)
    #expect(swift.pendingJoins.read(userId: nil, now: Date())?.code == "654321")

    let cleared = try result(try await runtime(device.merging(["op": "clearPendingJoin"]) { $1 }))
    #expect(cleared["pendingJoin"] is NSNull)
    #expect(try result(try await runtime(device.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)

    // Saved signed in: the user's own. Signed out it reads as none (and stays); another user's
    // read removes it.
    let ada = device.merging(["userId": "ada", "token": "jwt"]) { $1 }
    _ = try result(try await runtime(ada.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
    #expect(swift.pendingJoins.read(userId: "ada", now: Date())?.savedBy == "ada")
    #expect(try result(try await runtime(device.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)
    let notSignedIn = ada.merging(["op": "readPendingJoin", "signedIn": false]) { $1 }
    #expect(try result(try await runtime(notSignedIn))["pendingJoin"] is NSNull)
    let own = try result(try await runtime(ada.merging(["op": "readPendingJoin"]) { $1 }))
    #expect((own["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    let other = try result(try await runtime(ada.merging(["op": "readPendingJoin", "userId": "bo"]) { $1 }))
    #expect(other["pendingJoin"] is NSNull)
    #expect(try result(try await runtime(ada.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)

    // Saved signed out: the first signed-in read takes it.
    _ = try result(try await runtime(device.merging(["op": "savePendingJoin", "code": "123456"]) { $1 }))
    let taken = try result(try await runtime(ada.merging(["op": "readPendingJoin"]) { $1 }))
    #expect((taken["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    #expect(swift.pendingJoins.read(userId: "ada", now: Date())?.savedBy == "ada")

    // An explicit onboardingDir wins over storageDir.
    let elsewhere = FileManager.default.temporaryDirectory.appendingPathComponent("invite-rt-\(UUID().uuidString)", isDirectory: true)
    _ = try result(try await runtime(["op": "savePendingJoin", "code": "123456", "onboardingDir": elsewhere.path]))
    #expect(PendingJoinStore(directory: elsewhere).read(userId: nil, now: Date())?.code == "123456")
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

    let signedOutDevice: [String: Any] = ["storageDir": storage, "userId": "", "token": ""]
    _ = try result(try await runtime(signedOutDevice.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
    // Signed out on this device: kept, nothing sent.
    let signedOut = try result(try await runtime(signedOutDevice.merging(["op": "resolvePendingJoin", "baseURL": joining]) { $1 }))
    #expect(signedOut["outcome"] as? String == "signedOut")
    #expect(signedOut["message"] as? String == PendingJoinOutcome.signedOutMessage)
    #expect((signedOut["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    // A token with no user id is signed out too, and never ends a session.
    let noUser = try result(try await runtime(signedOutDevice.merging(["op": "resolvePendingJoin", "baseURL": expired, "token": "jwt"]) { $1 }))
    #expect(noUser["outcome"] as? String == "signedOut")

    // A full race: the message, and the code kept for a retry, now Ada's.
    let refused = try result(try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": full]) { $1 }))
    #expect(refused["outcome"] as? String == "raceFull" && refused["clearsCode"] as? Bool == false)
    #expect(refused["message"] as? String == PendingJoinOutcome.raceFullMessage)
    #expect((refused["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    #expect(try result(try await runtime(signedOutDevice.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)

    // The server refusing the session fails like every op's 401, so the app signs out. The code
    // stays for Ada's next sign-in.
    let rejected = try await runtime(ada.merging(["op": "resolvePendingJoin", "baseURL": expired]) { $1 })
    #expect(rejected["ok"] as? Bool == false && rejected["sessionExpired"] as? Bool == true)
    #expect(rejected["message"] as? String == PendingJoinOutcome.signedOutMessage)
    let kept = try result(try await runtime(ada.merging(["op": "readPendingJoin"]) { $1 }))
    #expect((kept["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")

    // Bo signs in next on this phone: nothing to join, nothing sent with Bo's token, Ada's code gone.
    let bo = ada.merging(["userId": "bo", "token": "jwt-bo"]) { $1 }
    let boResolve = try result(try await runtime(bo.merging(["op": "resolvePendingJoin", "baseURL": joining]) { $1 }))
    #expect(boResolve["outcome"] as? String == "nothingPending" && boResolve["pendingJoin"] is NSNull)
    #expect(await server.sent.isEmpty)
    #expect(try result(try await runtime(ada.merging(["op": "readPendingJoin"]) { $1 }))["pendingJoin"] is NSNull)

    // A replay never joins: refused before any request.
    _ = try result(try await runtime(ada.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
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

    // Signed in, the saved code is the reader's: Ada's join, never Bo's.
    let ada: [String: Any] = ["storageDir": storage, "userId": "ada", "token": "jwt", "races": [] as [Any]]
    let adaRead = try result(try await runtime(ada.merging(["op": "readOnboarding"]) { $1 }))
    #expect((adaRead["state"] as? [String: Any])?["step"] as? String == "join")
    #expect((adaRead["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    let boRead = try result(try await runtime(ada.merging(["op": "readOnboarding", "userId": "bo"]) { $1 }))
    #expect(boRead["pendingJoin"] is NSNull)
    #expect((boRead["state"] as? [String: Any])?["flow"] as? String == "chooser")
    // markOnboardingStep reads it the same way: Ada's code is her join over a runner pick, and
    // never turns Bo's runner pick into a join.
    _ = try result(try await runtime(ada.merging(["op": "savePendingJoin", "code": "123456"]) { $1 }))
    let adaMark = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "choice": "runner"]) { $1 }))
    #expect((adaMark["state"] as? [String: Any])?["flow"] as? String == "crew")
    let boMark = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "userId": "bo", "choice": "runner"]) { $1 }))
    #expect((boMark["state"] as? [String: Any])?["flow"] as? String == "runner")

    // Saved more than 7 days ago: expired, so no invite.
    let store = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: storage, isDirectory: true)))
    try store.pendingJoins.save(code: "123456", source: .link, userId: nil, now: Date().addingTimeInterval(-8 * day))
    let stale = try result(try await runtime(signedOut.merging(["op": "readOnboarding"]) { $1 }))
    #expect(stale["pendingJoin"] is NSNull)
    #expect((stale["state"] as? [String: Any])?["flow"] as? String == "chooser")
}

// MARK: - Review round 3

@Test func aLinkOpenedWhileTheJoinIsOutIsTheNextCode() async throws {
    let (_, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: "ada", now: t0)
    // The join answers only after a newer link has been saved.
    let server = JoinServer(join: .wait({
        _ = try? pending.save(code: "654321", source: .link, userId: "ada", now: t0.addingTimeInterval(30))
    }, then: .joined("r9")))
    let outcome = await pending.resolve(graph: graph(server), userId: "ada")
    #expect(outcome == .joined(roomId: "r9"))
    // The join cleared only its own code: the newer one is next, and the screen shows it.
    #expect(pending.nextCode(after: outcome, userId: "ada", now: t0.addingTimeInterval(60))?.code == "654321")
    // Nothing newer: nothing next. An outcome that isn't a membership keeps its own code on screen.
    try pending.clear()
    #expect(pending.nextCode(after: outcome, userId: "ada", now: t0) == nil)
    try pending.save(code: "111111", source: .link, userId: "ada", now: t0)
    #expect(pending.nextCode(after: .raceFull, userId: "ada", now: t0) == nil)
    #expect(pending.nextCode(after: .alreadyMember(roomId: "r1"), userId: "ada", now: t0)?.code == "111111")
}

@Test func aConfirmationStampedAheadOfTheClockIsExpiredAndDropped() throws {
    let (onboarding, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    // Within a minute ahead (jitter): still counts.
    try onboarding.mark(.join, invite: "123456", userId: nil, now: t0.addingTimeInterval(30))
    #expect(try onboarding.read(signedIn: false, userId: nil, now: t0).state.inviteConfirmed)

    // Stamped two minutes ahead: expired, and removed from the file on that read.
    try onboarding.mark(.join, invite: "123456", userId: nil, now: t0.addingTimeInterval(120))
    #expect(try !onboarding.read(signedIn: false, userId: nil, now: t0).state.inviteConfirmed)
    #expect(onboarding.load(userId: nil).confirmedInvite == nil)
    #expect(onboarding.load(userId: nil).confirmedInviteAt == nil)
    // The clock catching up doesn't bring it back.
    #expect(try !onboarding.read(signedIn: false, userId: nil, now: t0.addingTimeInterval(120)).state.inviteConfirmed)
}

@Test func anExpiredConfirmationIsDroppedFromTheFileOnRead() throws {
    let (onboarding, pending, _) = stores()
    try pending.save(code: "123456", source: .link, userId: nil, now: t0)
    try onboarding.mark(.join, invite: "123456", userId: nil, now: t0)
    _ = try onboarding.read(signedIn: false, userId: nil, now: t0.addingTimeInterval(OnboardingProgress.confirmedInviteLifetime + 1))
    #expect(onboarding.load(userId: nil).confirmedInvite == nil)
    // A clock moved back afterwards finds nothing to revive.
    #expect(try !onboarding.read(signedIn: false, userId: nil, now: t0).state.inviteConfirmed)
}

@Test func giveUpInviteRuntimeOpClearsTheCodeAndTheConfirmation() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("invite-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let signedOut: [String: Any] = ["storageDir": storage, "userId": "", "token": ""]
    _ = try result(try await runtime(signedOut.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
    let marked = try result(try await runtime(signedOut.merging(["op": "markOnboardingStep", "step": "join", "invite": "123456"]) { $1 }))
    #expect((marked["state"] as? [String: Any])?["inviteConfirmed"] as? Bool == true)

    let gaveUp = try result(try await runtime(signedOut.merging(["op": "giveUpInvite"]) { $1 }))
    #expect(gaveUp["pendingJoin"] is NSNull)
    #expect((gaveUp["state"] as? [String: Any])?["flow"] as? String == "chooser")

    // The same link again: the preview (step join), not the sign-in, and nothing confirmed.
    _ = try result(try await runtime(signedOut.merging(["op": "savePendingJoin", "code": "123456", "source": "link"]) { $1 }))
    let again = try #require(try result(try await runtime(signedOut.merging(["op": "readOnboarding"]) { $1 }))["state"] as? [String: Any])
    #expect(again["step"] as? String == "join" && again["inviteConfirmed"] as? Bool == false)
}
