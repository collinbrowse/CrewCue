import Foundation
import Testing
@testable import CrewCueClientCore

// Race rename and the race lock (clients/behavior/race-rename-and-lock.md).

private func lockGraph(_ transport: any HTTPTransport) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: StaticTokenProvider(token: "token")
    )
}

/// Answers by method and path and records each request body.
private actor LockServer: HTTPTransport {
    private let replies: [String: (status: Int, body: String)]
    private(set) var requests: [(key: String, body: String)] = []

    init(_ replies: [String: (status: Int, body: String)]) {
        self.replies = replies
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let key = "\(request.method.rawValue) \(request.url.path)"
        requests.append((key, request.body.map { String(decoding: $0, as: UTF8.self) } ?? ""))
        guard let reply = replies[key] else {
            return HTTPResponse(status: 404, body: Data(#"{"error":"Not found"}"#.utf8))
        }
        return HTTPResponse(status: reply.status, body: Data(reply.body.utf8))
    }

    func keys() -> [String] { requests.map(\.key) }
}

private func roomJSON(name: String, raceLockedAt: String? = nil) -> String {
    let lock = raceLockedAt.map { #","raceLockedAt":"\#($0)""# } ?? ""
    return #"{"id":"room","teamId":"t","athleteId":"a","name":"\#(name)","status":"active","createdAt":"2026-11-01T00:00:00.000Z","raceStartAt":"2026-11-21T14:30:00.000Z"\#(lock),"memberships":[{"userId":"a","role":"athlete","joinedAt":"2026-11-01T00:00:00.000Z"}],"entitlement":{"status":"paid","lastUpdatedAt":"2026-11-01T00:00:00.000Z","source":"manual"}}"#
}

private let lockedBody = #"{"error":"This race has started, so its course and start time are locked. You can still rename it and edit aid stations.","code":"race_locked"}"#

@Test func renameRacePatchesTheTrimmedNameAndReadsTheRoom() async throws {
    let server = LockServer(["PATCH /race-rooms/room": (200, roomJSON(name: "Canyons 100K", raceLockedAt: "2026-11-21T14:31:00.000Z"))])
    let room = try await RaceDayAPI.renameRace(graph: lockGraph(server), roomId: "room", name: "  Canyons 100K ")
    #expect(room.name == "Canyons 100K")
    #expect(RaceLock.isLocked(room))
    let request = try #require(await server.requests.first)
    #expect(request.key == "PATCH /race-rooms/room")
    let object = try #require(try JSONSerialization.jsonObject(with: Data(request.body.utf8)) as? [String: String])
    #expect(object == ["name": "Canyons 100K"])
}

@Test func renameRaceRefusesAnEmptyOrLongNameWithoutCallingTheServer() async throws {
    let server = LockServer([:])
    for name in ["   ", String(repeating: "x", count: 81)] {
        do {
            _ = try await RaceDayAPI.renameRace(graph: lockGraph(server), roomId: "room", name: name)
            Issue.record("expected a 400 for \(name.count) characters")
        } catch let error as ClientHTTPError {
            #expect(error.status == 400)
            #expect(UserFacingError(error).message == RaceName.invalidMessage)
        }
    }
    #expect(await server.keys().isEmpty)
    #expect(RaceName.validated(String(repeating: "x", count: 80))?.count == 80)
}

@Test func theRoomAndTheRaceListCarryTheLock() throws {
    let locked = try JSONDecoder().decode(RaceRoom.self, from: Data(roomJSON(name: "Run", raceLockedAt: "2026-11-21T14:31:00.000Z").utf8))
    let open = try JSONDecoder().decode(RaceRoom.self, from: Data(roomJSON(name: "Run").utf8))
    #expect(locked.raceLockedAt == "2026-11-21T14:31:00.000Z")
    #expect(RaceLock.isLocked(locked))
    #expect(RaceLock.isLocked(open) == false)
    #expect(RaceSummary(room: locked, userId: "a").isRaceLocked)
    #expect(RaceSummary(room: open, userId: "a").isRaceLocked == false)
    // A summary stored before the lock existed still decodes.
    let stored = try JSONDecoder().decode(RaceSummary.self, from: Data(#"{"id":"room","name":"Run","role":"athlete"}"#.utf8))
    #expect(stored.isRaceLocked == false)
}

@Test func aLockedRaceRefusalIsPlainCopy() async throws {
    let server = LockServer(["PATCH /race-rooms/room/race-start": (409, lockedBody)])
    do {
        _ = try await RaceDayAPI.updateRaceStart(graph: lockGraph(server), roomId: "room", raceStartAt: "2026-11-28T14:30:00.000Z")
        Issue.record("expected a 409")
    } catch {
        #expect(RaceLock.isLockedError(error))
        let http = try #require(error as? ClientHTTPError)
        let shown = UserFacingError(http)
        #expect(shown == UserFacingError(code: "race_locked", message: RaceLock.message, retryable: false))
        #expect(OnboardingSetupFailure.classify(error, courseSave: true) == .courseLocked)
        #expect(OnboardingSetupFailure.courseLocked.message == RaceLock.message)
        // A queued course upload the lock refuses is dropped with the same copy, not retried.
        let resolution = OutboxPolicy.resolve(error)
        #expect(resolution.status == "rejected")
        #expect(resolution.retryable == false)
        #expect(resolution.feedback == RaceLock.message)
    }
    // Another 409 is not the lock.
    #expect(RaceLock.isLockedError(ClientHTTPError(status: 409, message: "Conflict", bodyError: "Already recorded")) == false)
}

@Test func raceSetupEditorsMatchTheAPI() {
    #expect(["athlete", "crew_chief", "team_manager"].allSatisfy(PlanAuthority.mayEditRaceSetup(role:)))
    #expect(PlanAuthority.mayEditRaceSetup(role: "crew_member") == false)
    #expect(PlanAuthority.mayEditRaceSetup(role: "") == false)
}

@Test func renameCopyIsPlain() {
    #expect(RaceRenameCopy.message(for: URLError(.notConnectedToInternet)) == RaceRenameCopy.offline)
    #expect(RaceRenameCopy.message(for: ClientHTTPError(status: 400, message: "Bad")) == RaceName.invalidMessage)
    #expect(RaceRenameCopy.message(for: ClientHTTPError(status: 403, message: "Insufficient permissions")) == RaceRenameCopy.failed)
    #expect(CrewCueClientCore.featureScreen(id: "race-rename", state: .success).accessibilityIdentifier == "crewcue.race-rename")
    #expect(CrewCueClientCore.featureScreen(id: "course-locked", state: .success).body == RaceLock.message)
}

@Test func aRenameKeepsTheActiveRace() {
    var roster = RaceRoster(
        races: [RaceSummary(id: "a", name: "A", role: "athlete"), RaceSummary(id: "b", name: "B", role: "athlete")],
        activeRoomId: "a"
    )
    roster.rename("b", to: "  Bigfoot 200 ")
    #expect(roster.races.map(\.name) == ["A", "Bigfoot 200"])
    #expect(roster.activeRoomId == "a")
    roster.rename("b", to: "   ")
    roster.rename("missing", to: "X")
    #expect(roster.races.map(\.name) == ["A", "Bigfoot 200"])
}

@Test func runtimeRenameRaceAnswersTheSavedNameOrTheSharedFailureLine() async throws {
    let server = LockServer(["PATCH /race-rooms/room": (200, roomJSON(name: "Canyons 100K"))])
    let ok = try await RuntimeCall.renameRace(graph: lockGraph(server), roomId: "room", name: " Canyons 100K ")
    #expect(ok["renamed"] as? Bool == true)
    #expect(ok["id"] as? String == "room")
    #expect(ok["name"] as? String == "Canyons 100K")
    #expect(ok["message"] as? String == RaceRenameCopy.saved)

    let empty = try await RuntimeCall.renameRace(graph: lockGraph(LockServer([:])), roomId: "room", name: "  ")
    #expect(empty["renamed"] as? Bool == false)
    #expect(empty["message"] as? String == RaceName.invalidMessage)

    let refused = LockServer(["PATCH /race-rooms/room": (403, #"{"error":"Insufficient permissions"}"#)])
    let failed = try await RuntimeCall.renameRace(graph: lockGraph(refused), roomId: "room", name: "Canyons")
    #expect(failed["renamed"] as? Bool == false)
    #expect(failed["message"] as? String == RaceRenameCopy.failed)

    let expired = LockServer(["PATCH /race-rooms/room": (401, #"{"error":"Unauthorized"}"#)])
    await #expect(throws: ClientHTTPError.self) {
        _ = try await RuntimeCall.renameRace(graph: lockGraph(expired), roomId: "room", name: "Canyons")
    }
}

@Test func runtimeRaceRenameCopyOffersTheRowToRaceSetupEditorsOnly() {
    for role in ["athlete", "crew_chief", "team_manager"] {
        #expect(RuntimeCall.raceRenameCopy(role: role)["mayRename"] as? Bool == true)
    }
    #expect(RuntimeCall.raceRenameCopy(role: "crew_member")["mayRename"] as? Bool == false)
    let copy = RuntimeCall.raceRenameCopy(role: "athlete")
    #expect(copy["rowTitle"] as? String == RaceRenameCopy.rowTitle)
    #expect(copy["hint"] as? String == "Your crew sees the new name. Up to 80 characters.")
    #expect(copy["maxLength"] as? Int == 80)
}
