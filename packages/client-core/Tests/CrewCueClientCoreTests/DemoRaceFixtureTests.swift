import Foundation
import Testing
@testable import CrewCueClientCore

// The replay's room source on iOS (clients/behavior/onboarding-race-preview.md): the runner's own
// `GET /race-rooms/:roomId` body, read once, or the dev route's fixture.

/// Answers `GET /race-rooms/room-1` with `body` and remembers what it was asked.
private final class RoomBodyTransport: HTTPTransport, @unchecked Sendable {
    let body: Data
    let status: Int
    private let lock = NSLock()
    private var seen: [HTTPRequest] = []

    init(body: Data, status: Int = 200) {
        self.body = body
        self.status = status
    }

    var requests: [HTTPRequest] {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }

    private func remember(_ request: HTTPRequest) {
        lock.lock()
        seen.append(request)
        lock.unlock()
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        remember(request)
        guard request.url.path == "/race-rooms/room-1" else { return HTTPResponse(status: 404, body: Data("{}".utf8)) }
        return HTTPResponse(status: status, body: body)
    }
}

private func roomGraph(_ transport: RoomBodyTransport) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://api.example.invalid"),
        tokenProvider: StaticTokenProvider(token: "runner-token")
    )
}

@Test func loadRoomDataReturnsTheServerBodyWithItsCourseLine() async throws {
    let body = try demoRoomData()
    let transport = RoomBodyTransport(body: body)
    let data = try await RaceDayAPI.loadRoomData(graph: roomGraph(transport), roomId: "room-1")
    #expect(data == body)
    let request = try #require(transport.requests.first)
    #expect(transport.requests.count == 1)
    #expect(request.method == .get)
    #expect(request.url.path == "/race-rooms/room-1")
    #expect(request.headers["Authorization"] == "Bearer runner-token")

    // The raw body keeps the map workspace, so the replay runs along the course line (5 points),
    // not straight between the 4 checkpoints a decoded `RoomEnvelope` would leave.
    #expect(try DemoRaceCourse(roomData: data, viewerUserId: "runner-1").line.count == 5)
    let decoded = try JSONEncoder().encode(try JSONDecoder().decode(RoomEnvelope.self, from: data))
    #expect(try DemoRaceCourse(roomData: decoded, viewerUserId: "runner-1").line.count == 4)
}

@Test func loadRoomDataThrowsWhatTheServerAnswered() async throws {
    let transport = RoomBodyTransport(body: Data(#"{"error":"Race room not found"}"#.utf8), status: 404)
    await #expect(throws: ClientHTTPError.self) {
        _ = try await RaceDayAPI.loadRoomData(graph: roomGraph(transport), roomId: "room-1")
    }
    do {
        _ = try await RaceDayAPI.loadRoomData(graph: roomGraph(transport), roomId: "room-1")
    } catch let error as ClientHTTPError {
        #expect(error.status == 404)
    }
}

@Test func aReplayThatCantStartShowsItsChecklistState() throws {
    // No course to run on: Empty ("Add your course to see the replay on your own route").
    var object = demoRoomObject()
    var room = try #require(object["room"] as? [String: Any])
    room["course"] = ["checkpoints": [["id": "start", "title": "Start", "latitude": 39.2, "longitude": -120.2, "distanceMetersFromStart": 0]]]
    room["mapWorkspace"] = nil
    object["room"] = room
    do {
        _ = try DemoRace.session(
            roomData: try JSONSerialization.data(withJSONObject: object), viewerUserId: "runner-1",
            logger: SilentLogger(), temporaryRoot: freshDirectory()
        )
        Issue.record("a one-checkpoint course has nothing to replay")
    } catch {
        #expect(DemoRace.unavailableState(error) == .empty)
    }
    #expect(DemoRace.unavailableState(DemoRaceError.noCourse) == .empty)
    // No network: Offline (the app plays the race saved on the phone when it has one).
    #expect(DemoRace.unavailableState(URLError(.notConnectedToInternet)) == .offline)
    #expect(DemoRace.unavailableState(URLError(.timedOut)) == .offline)
    // Anything else: Error, with Skip.
    #expect(DemoRace.unavailableState(DemoRaceError.noStartTime) == .error)
    #expect(DemoRace.unavailableState(DemoRaceError.invalidRoom) == .error)
    #expect(DemoRace.unavailableState(ClientHTTPError(status: 404, message: "Race room not found")) == .error)
    #expect(DemoRace.unavailableState(ClientHTTPError(status: 402, message: "room_unpaid")) == .error)
}

@Test func demoRaceFixturePlaysTheWholeReplayWithoutAnAPI() async throws {
    let root = freshDirectory()
    let clock = ManualWallClock()
    let demo = try DemoRace.session(
        roomData: DemoRaceFixture.roomData,
        viewerUserId: DemoRaceFixture.runnerUserId,
        logger: SilentLogger(),
        temporaryRoot: root,
        wallClock: clock
    )
    let course = demo.player.script.course
    #expect(demo.roomId == DemoRaceFixture.roomId)
    #expect(course.line.count == DemoRaceFixture.line.count)
    #expect(course.courseLengthMeters == DemoRaceFixture.courseLengthMeters)
    #expect(course.lockedCheckpointIds == ["aid-1", "aid-2", "aid-3"])
    #expect(course.raceStart == ScheduleFormat.parseISO8601(DemoRaceFixture.raceStartAt))
    #expect(course.plannedFinishSeconds == DemoRaceFixture.finishElapsedSeconds)
    // The fixture's times are `ScheduleFixture`'s: the same start and finish.
    #expect(DemoRaceFixture.raceStartAt == ScheduleFixture.stops.first?.clockArrivalAt)
    #expect(DemoRaceFixture.finishAt == ScheduleFixture.stops.last?.clockArrivalAt)

    // The routes the Map, Pace and Chat views read all answer from the fixture.
    demo.player.play()
    clock.set(22)
    demo.player.tick()
    let room = try await RaceDayAPI.loadRoom(graph: demo.graph, roomId: DemoRaceFixture.roomId)
    #expect(room.room.name == DemoRaceFixture.raceName)
    #expect(room.room.entitlement.status == "unpaid")
    let schedule = try await RaceDayAPI.loadScheduleResult(graph: demo.graph, roomId: DemoRaceFixture.roomId, cacheDirectory: nil)
    #expect(schedule.sheet.stops.map(\.checkpointId) == ["start", "finish"])
    #expect(schedule.sheet.locked?.checkpointIds == ["aid-1", "aid-2", "aid-3"])
    #expect(try await RaceDayAPI.latestPing(graph: demo.graph, roomId: DemoRaceFixture.roomId).ping != nil)
    #expect(try await RaceDayAPI.liveProjection(graph: demo.graph, roomId: DemoRaceFixture.roomId) != nil)
    let chat = try await RaceDayAPI.chatMessages(graph: demo.graph, roomId: DemoRaceFixture.roomId)
    #expect(chat.messages.map(\.text) == [DemoRaceScript.crewMessage])

    clock.set(DemoRaceScript.durationSeconds)
    let last = demo.player.tick()
    #expect(last.isFinished && !last.wasSkipped)
    #expect(!FileManager.default.fileExists(atPath: demo.cacheDirectory.path))
}
