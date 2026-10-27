import Foundation
import Testing
@testable import CrewCueClientCore

private let roomsJSON = #"""
{"rooms":[
  {"id":"room-b","teamId":"t","athleteId":"ada","name":" Leadville ","status":"active","createdAt":"2026-09-02T00:00:00.000Z",
   "raceStartAt":"2026-10-20T12:00:00.000Z",
   "memberships":[{"userId":"me","role":"crew_member","joinedAt":"2026-09-02T00:00:00.000Z","displayName":" Pacer Pat "}],
   "entitlement":{"status":"active","lastUpdatedAt":"2026-09-01T00:00:00.000Z","source":"free"}},
  {"id":"room-a","teamId":"t","athleteId":"me","name":"  ","status":"draft","createdAt":"2026-09-01T00:00:00.000Z",
   "memberships":[{"userId":"me","role":"athlete","joinedAt":"2026-09-01T00:00:00.000Z"}],
   "entitlement":{"status":"active","lastUpdatedAt":"2026-09-01T00:00:00.000Z","source":"free"}}
]}
"""#

private struct RoomsTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard request.url.path == "/race-rooms/mine" else { return HTTPResponse(status: 404, body: Data("{}".utf8)) }
        return HTTPResponse(status: 200, body: Data(roomsJSON.utf8))
    }
}

private func roomsGraph() -> ClientGraph {
    ClientGraph(
        transport: RoomsTransport(),
        clock: SystemClock(),
        logger: SilentTestLogger(),
        baseURL: URL(string: "https://example.invalid"),
        tokenProvider: StaticTokenProvider(token: "t")
    )
}

private struct SilentTestLogger: Logger {
    func log(_ message: String) {}
}

@Test func myRacesMapsRolePerRoom() async throws {
    let races = try await RaceDayAPI.myRaces(graph: roomsGraph(), userId: "me")
    #expect(races.map(\.id) == ["room-b", "room-a"])
    #expect(races[0].name == "Leadville")
    #expect(races[0].role == "crew_member")
    #expect(races[0].raceStartAt == "2026-10-20T12:00:00.000Z")
    #expect(races[0].displayName == "Pacer Pat")
    #expect(races[1].name == "Untitled race")
    #expect(races[1].displayName == nil)
    #expect(races[1].role == "athlete")
}

@Test func roleLabelsNeverShowWireValues() {
    #expect(RaceRole.label("athlete") == "Runner")
    #expect(RaceRole.label("crew_member") == "Crew member")
    #expect(RaceRole.label("crew_chief") == "Crew chief")
    #expect(RaceRole.label("team_manager") == "Team manager")
    #expect(RaceRole.label("SAFETY_LEAD") == "Safety lead")
    #expect(RaceRole.label("") == "")
    #expect(RaceSummary(id: "a", name: "A", role: "crew_member").roleLabel == "Crew member")
}

@Test func rosterKeepsListedPreferenceAndFallsBackToFirst() {
    let races = [
        RaceSummary(id: "b", name: "B", role: "crew_member"),
        RaceSummary(id: "a", name: "A", role: "athlete"),
        RaceSummary(id: "a", name: "dup", role: "athlete")
    ]
    let kept = RaceRoster.reconciled(races: races, preferred: " a ")
    #expect(kept.races.count == 2)
    #expect(kept.active?.name == "A")

    let removed = RaceRoster.reconciled(races: races, preferred: "gone")
    #expect(removed.activeRoomId == "b")

    let none = RaceRoster.reconciled(races: [], preferred: "gone")
    #expect(none.activeRoomId == nil)
    #expect(none.active == nil)
}

@Test func rosterSelectsOnlyListedRacesAndAdoptsNewOnes() {
    var roster = RaceRoster.reconciled(
        races: [RaceSummary(id: "a", name: "A", role: "athlete"), RaceSummary(id: "b", name: "B", role: "crew_member")],
        preferred: "a"
    )
    #expect(roster.select("missing") == nil)
    #expect(roster.activeRoomId == "a")
    #expect(roster.select("b")?.role == "crew_member")
    #expect(roster.activeRoomId == "b")

    roster.adopt(RaceSummary(id: "c", name: "C", role: "athlete"))
    #expect(roster.races.map(\.id) == ["a", "b", "c"])
    #expect(roster.activeRoomId == "c")
}

@Test func sessionSelectFollowsTheRoomRole() {
    let controller = SessionController(session: ClientSession(userId: "me", role: "athlete", roomId: "a", displayName: "Ada"))
    controller.select(RaceSummary(id: "b", name: "B", role: "crew_member", displayName: "Pat"))
    #expect(controller.session?.roomId == "b")
    #expect(controller.session?.role == "crew_member")
    #expect(controller.session?.displayName == "Pat")
    controller.select(RaceSummary(id: "c", name: "C", role: "athlete"))
    #expect(controller.session?.displayName == nil)
}

@Test func roomStorageSeparatesRooms() {
    let root = URL(fileURLWithPath: "/tmp/user", isDirectory: true)
    let a = RoomStorage.directory(userDirectory: root, roomId: "room-a")
    let b = RoomStorage.directory(userDirectory: root, roomId: "room-b")
    #expect(a != b)
    #expect(a.path.hasPrefix("/tmp/user/rooms/"))
    #expect(RoomStorage.directory(userDirectory: root, roomId: "../x").path.contains("..") == false)
}

@Test func courseSettingsDraftsStayPerRoomThroughTheRuntime() async throws {
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: storage) }
    func call(_ fields: [String: Any]) async throws -> [String: Any] {
        var request = fields
        request["storageDir"] = storage.path
        request["userId"] = "me"
        let data = try JSONSerialization.data(withJSONObject: request)
        let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
        return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    }
    _ = try await call(["op": "writeCourseSettings", "roomId": "a", "cutoffNote": "Aid 3 by 2pm", "stoppageSeconds": 120])
    _ = try await call(["op": "writeCourseSettings", "roomId": "b", "cutoffNote": "Twin Lakes 6pm", "stoppageSeconds": 60])
    let a = try await call(["op": "readCourseSettings", "roomId": "a", "baseURL": "https://example.invalid"])
    let b = try await call(["op": "readCourseSettings", "roomId": "b", "baseURL": "https://example.invalid"])
    #expect(((a["result"] as? [String: Any])?["cutoffNote"] as? String) == "Aid 3 by 2pm")
    #expect(((b["result"] as? [String: Any])?["cutoffNote"] as? String) == "Twin Lakes 6pm")

    let missingRoom = try await call(["op": "writeCourseSettings", "cutoffNote": "x", "stoppageSeconds": 1])
    #expect((missingRoom["ok"] as? Bool) == false)
}
