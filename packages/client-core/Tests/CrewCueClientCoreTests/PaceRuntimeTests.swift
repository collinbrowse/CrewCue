import Foundation
import Testing
@testable import CrewCueClientCore

@Test func scheduleLineMatchesFixtureAidClock() {
    let line = ScheduleFormat.scheduleLine(
        checkpointId: "aid-1",
        elapsedSeconds: 4200,
        clockArrivalAt: "2026-08-15T14:10:00.000Z"
    )
    #expect(line == "Aid 1  1:10:00  14:10 UTC")
}

@Test func courseDraftReadsCutoffAndStoppage() throws {
    let json = """
    {"room":{"course":{"checkpoints":[
      {"id":"aid-1","plannedStopSeconds":60,"cutoff":{"mode":"time_of_day","hour":18,"minute":30}},
      {"id":"aid-2","plannedStopSeconds":30,"cutoff":{"mode":"elapsed_from_start","seconds":18000}}
    ]}}}
    """
    let draft = RaceDayAPI.courseDraft(fromRoomData: Data(json.utf8))
    #expect(draft.stoppageSeconds == 90)
    #expect(draft.cutoffNote.contains("Aid 1 cutoff 18:30"))
    #expect(draft.cutoffNote.contains("Aid 2 cutoff 5:00:00"))
}

@Test func scheduleResultUsesCacheOnlyWhenOffline() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stop = ScheduleStop(
        id: "stop-aid-1",
        checkpointId: "aid-1",
        clockArrivalAt: "2026-08-15T14:10:00.000Z",
        elapsedSeconds: 4200,
        plannedStoppageSeconds: 0
    )
    let sheet = CrewScheduleSheet(roomId: "room", raceStartAt: "2026-08-15T13:00:00.000Z", stops: [stop])
    try ScheduleCache.save(sheet, directory: directory)
    let offlineGraph = ClientGraph(
        transport: OfflineTransport(),
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")
    )
    let loaded = try await RaceDayAPI.loadScheduleResult(graph: offlineGraph, roomId: "room", cacheDirectory: directory)
    #expect(loaded.offline)
    #expect(loaded.sheet.stops.count == 1)

    let failedGraph = ClientGraph(
        transport: StatusTransport(status: 500),
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")
    )
    do {
        _ = try await RaceDayAPI.loadScheduleResult(graph: failedGraph, roomId: "room", cacheDirectory: directory)
        Issue.record("a server error should not masquerade as an offline sheet")
    } catch {
        #expect(!TransportFailure.isOffline(error))
    }
    let fallback = try await RaceDayAPI.loadSchedule(graph: failedGraph, roomId: "room", cacheDirectory: directory)
    #expect(fallback.roomId == "room")
}

@Test func runtimeDecideBlocksCrewAutoRecompute() async throws {
    let crew = try await runtimeCall([
        "op": "decideEstimate",
        "role": "crew_member",
        "estimateId": "est",
        "coldStart": true,
        "usableHistoryCount": 1,
        "historyFingerprint": "a"
    ])
    let crewResult = try resultObject(crew)
    #expect(flag(crewResult, "recompute") == false)
    #expect(flag(crewResult, "mayRecalculate"))
    #expect(flag(crewResult, "mayAutoRecompute") == false)

    let athlete = try await runtimeCall([
        "op": "decideEstimate",
        "role": "athlete",
        "estimateId": "est",
        "coldStart": true,
        "usableHistoryCount": 1,
        "historyFingerprint": "a"
    ])
    let athleteResult = try resultObject(athlete)
    #expect(flag(athleteResult, "recompute"))
    #expect((athleteResult["reason"] as? String) == "cold-start-with-history")
}

@Test func runtimeCourseDraftAndCrewSheetStayOnDevice() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let saved = try await runtimeCall([
        "op": "writeCourseSettings",
        "storageDir": directory.path,
        "roomId": "room",
        "cutoffNote": "Aid 1 cutoff 18:30",
        "stoppageSeconds": 90
    ])
    let draft = try resultObject(saved)
    #expect((draft["cutoffNote"] as? String) == "Aid 1 cutoff 18:30")
    #expect(try #require(number(draft["stoppageSeconds"])) == 90)
    let loaded = try await runtimeCall([
        "op": "readCourseSettings",
        "storageDir": directory.path,
        "roomId": "room",
        "baseURL": "https://example.invalid"
    ])
    let again = try resultObject(loaded)
    #expect((again["cutoffNote"] as? String) == "Aid 1 cutoff 18:30")
    #expect(flag(again, "offline") == false)

    let stop = ScheduleStop(
        id: "stop-aid-1",
        checkpointId: "aid-1",
        clockArrivalAt: "2026-08-15T14:10:00.000Z",
        elapsedSeconds: 4200,
        plannedStoppageSeconds: 0
    )
    try ScheduleCache.save(
        CrewScheduleSheet(roomId: "room-1", raceStartAt: "2026-08-15T13:00:00.000Z", stops: [stop]),
        directory: RoomStorage.directory(userDirectory: UserStorage(root: directory).directory(userId: "guest"), roomId: "room-1")
    )
    let exported = try await runtimeCall([
        "op": "exportCrewSheet",
        "storageDir": directory.path,
        "roomId": "room-1"
    ])
    let sheet = try resultObject(exported)
    let text = try #require(sheet["text"] as? String)
    #expect(text.contains("Crew sheet"))
    #expect(text.contains("Aid 1  1:10:00  14:10 UTC"))
    #expect(text.contains("Room room-1"))
}

@Test func runtimeCheckInRejectsEmptyAndListsQueuedWork() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let rejected = try await runtimeCall([
        "op": "enqueueCheckIn",
        "storageDir": directory.path,
        "userId": "crew-1",
        "roomId": "room",
        "checkpointId": "aid-1",
        "arrivalAt": "",
        "departureAt": "",
        "role": "crew_member"
    ])
    #expect(flag(rejected, "ok") == false)
    #expect((rejected["message"] as? String) == "Arrival and departure are required.")

    let reversed = try await runtimeCall([
        "op": "enqueueCheckIn",
        "storageDir": directory.path,
        "userId": "crew-1",
        "roomId": "room",
        "checkpointId": "aid-1",
        "arrivalAt": "2026-08-15T14:16:00.000Z",
        "departureAt": "2026-08-15T14:10:00.000Z",
        "role": "crew_member"
    ])
    #expect((reversed["message"] as? String) == "Departure must be after arrival.")

    _ = try await runtimeCall([
        "op": "enqueueCheckIn",
        "storageDir": directory.path,
        "userId": "crew-1",
        "roomId": "room",
        "checkpointId": "aid-1",
        "arrivalAt": "2026-08-15T14:10:00.000Z",
        "departureAt": "2026-08-15T14:16:00.000Z",
        "role": "crew_member"
    ])
    let listed = try await runtimeCall([
        "op": "listOutbox",
        "storageDir": directory.path,
        "userId": "crew-1"
    ])
    let outbox = try resultObject(listed)
    #expect(try #require(number(outbox["pending"])) == 1)
    #expect(flag(outbox, "rejected") == false)
}

private struct OfflineTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw URLError(.notConnectedToInternet)
    }
}

private struct StatusTransport: HTTPTransport {
    var status: Int
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        HTTPResponse(status: status, body: Data(#"{"message":"down"}"#.utf8))
    }
}

private func runtimeCall(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func resultObject(_ root: [String: Any]) throws -> [String: Any] {
    try #require(root["result"] as? [String: Any])
}

private func flag(_ object: [String: Any], _ key: String) -> Bool {
    if let value = object[key] as? Bool { return value }
    if let value = object[key] as? NSNumber { return value.boolValue }
    return false
}

private func number(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    if let number = value as? Double { return number }
    if let number = value as? Int { return Double(number) }
    return nil
}
