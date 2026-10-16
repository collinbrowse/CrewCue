import Foundation
import Testing
@testable import CrewCueClientCore

private let mile = 1609.344

private let checkpoints = [
    AidStationCheckpoint(id: "start", title: "Start", distanceMetersFromStart: 0, plannedStopSeconds: 0),
    AidStationCheckpoint(id: "aid-2", title: "Ridge", distanceMetersFromStart: 20 * mile, plannedStopSeconds: 300),
    AidStationCheckpoint(id: "aid-1", title: "Creek", distanceMetersFromStart: 10 * mile, plannedStopSeconds: 120),
    AidStationCheckpoint(id: "finish", title: "Finish", distanceMetersFromStart: 30 * mile, plannedStopSeconds: 0)
]

private let stops = [
    ScheduleStop(id: "s0", checkpointId: "start", clockArrivalAt: "2026-08-15T12:00:00.000Z", elapsedSeconds: 0, plannedStoppageSeconds: 0),
    ScheduleStop(id: "s1", checkpointId: "aid-1", clockArrivalAt: "2026-08-15T14:00:00.000Z", elapsedSeconds: 7200, plannedStoppageSeconds: 120),
    ScheduleStop(
        id: "s2",
        checkpointId: "aid-2",
        clockArrivalAt: "2026-08-15T16:02:00.000Z",
        elapsedSeconds: 14520,
        plannedStoppageSeconds: 300,
        cutoffStatus: "ok",
        cutoffMarginSeconds: 1200
    ),
    ScheduleStop(id: "s3", checkpointId: "finish", clockArrivalAt: "2026-08-15T18:07:00.000Z", elapsedSeconds: 22020, plannedStoppageSeconds: 0)
]

@Test func draftOrdersByDistanceAndLocksStartFinishAndPassedStops() {
    let fresh = StopPlanDraft(checkpoints: checkpoints, progressMeters: 0)
    #expect(fresh.rows.map(\.checkpointId) == ["start", "aid-1", "aid-2", "finish"])
    #expect(fresh.rows.map(\.editable) == [false, true, true, false])
    #expect(fresh.row("aid-1")?.minutesText == "2")
    #expect(fresh.row("aid-2")?.title == "RIDGE")

    let midRace = StopPlanDraft(checkpoints: checkpoints, progressMeters: 12 * mile)
    #expect(midRace.row("aid-1")?.editable == false)
    #expect(midRace.row("aid-2")?.editable == true)
}

@Test func minutesParsingAcceptsWholeMinutesWithinSixHours() {
    #expect(StopPlanDraft.parseMinutes("") == .ok(seconds: 0))
    #expect(StopPlanDraft.parseMinutes(" 15 ") == .ok(seconds: 900))
    #expect(StopPlanDraft.parseMinutes("360") == .ok(seconds: 21_600))
    for bad in ["361", "-5", "2.5", "abc", "1:30", "٣"] {
        #expect(StopPlanDraft.parseMinutes(bad) == .invalid("Enter whole minutes from 0 to 360."), "\(bad)")
    }
}

@Test func editsOnlyCarryChangedRowsAndInvalidInputBlocksSave() {
    var draft = StopPlanDraft(checkpoints: checkpoints, progressMeters: 0)
    #expect(draft.canSave == false)

    draft.setMinutes("10", for: "aid-1")
    #expect(draft.edits == [PlannedStopEdit(checkpointId: "aid-1", plannedStopSeconds: 600)])
    #expect(draft.canSave)

    draft.setMinutes("5", for: "aid-2")
    #expect(draft.edits.count == 1, "5 min equals the saved 300 s, so it is not a change")

    draft.setMinutes("abc", for: "aid-2")
    #expect(draft.row("aid-2")?.error == "Enter whole minutes from 0 to 360.")
    #expect(draft.row("aid-2")?.minutesText == "abc", "typed text is kept")
    #expect(draft.row("aid-2")?.draftSeconds == 300, "invalid input leaves the last good value")
    #expect(draft.canSave == false)

    #expect(draft.setMinutes("9", for: "finish") == .invalid("This stop can't be changed."))
    #expect(draft.row("finish")?.draftSeconds == 0)

    draft.reset()
    #expect(draft.hasChanges == false)
    #expect(draft.hasErrors == false)
    #expect(draft.row("aid-2")?.minutesText == "5")
}

@Test func stepperClampsToRange() {
    var draft = StopPlanDraft(checkpoints: checkpoints, progressMeters: 0)
    draft.step("aid-1", deltaMinutes: -5)
    #expect(draft.row("aid-1")?.draftSeconds == 0)
    draft.step("aid-1", deltaMinutes: 400)
    #expect(draft.row("aid-1")?.draftSeconds == 21_600)
    draft.step("start", deltaMinutes: 5)
    #expect(draft.row("start")?.draftSeconds == 0)
}

@Test func projectedStopsShiftLaterArrivalsAndRecomputeCutoffs() {
    var draft = StopPlanDraft(checkpoints: checkpoints, progressMeters: 0)
    draft.setMinutes("20", for: "aid-1") // +18 min
    draft.setMinutes("0", for: "aid-2")  // −5 min
    let projected = draft.projectedStops(stops)

    #expect(projected[1].clockArrivalAt == "2026-08-15T14:00:00.000Z", "a stop never delays its own arrival")
    #expect(projected[1].plannedStoppageSeconds == 1200)
    #expect(projected[2].elapsedSeconds == 14520 + 1080)
    #expect(projected[2].clockArrivalAt == "2026-08-15T16:20:00.000Z")
    #expect(projected[2].cutoffMarginSeconds == 120)
    #expect(projected[2].cutoffStatus == "warn")
    #expect(projected[3].elapsedSeconds == 22020 + 1080 - 300)
    #expect(projected[3].clockArrivalAt == "2026-08-15T18:20:00.000Z")

    draft.setMinutes("60", for: "aid-1")
    #expect(draft.projectedStops(stops)[2].cutoffStatus == "breach")
    #expect(StopPlanDraft(checkpoints: checkpoints, progressMeters: 0).projectedStops(stops) == stops)
}

@Test func stopLabelReadsLikeTheRail() {
    #expect(StopPlanDraft.stopLabel(seconds: 0) == "NO STOP")
    #expect(StopPlanDraft.stopLabel(seconds: 120) == "2 MIN STOP")
    #expect(StopPlanDraft.stopLabel(seconds: 5400) == "1H 30M STOP")
    #expect(StopPlanDraft.stopLabel(seconds: 7200) == "2H STOP")
}

@Test func courseEditorsMatchTheServerRule() {
    #expect(PlanAuthority.mayEditCourse(role: "athlete"))
    #expect(PlanAuthority.mayEditCourse(role: "crew_chief"))
    #expect(PlanAuthority.mayEditCourse(role: "team_manager"))
    #expect(PlanAuthority.mayEditCourse(role: "crew_member") == false)
    #expect(PlanAuthority.mayEditCourse(role: "") == false)
}

private actor StopsCaptureTransport: HTTPTransport {
    private(set) var method: String?
    private(set) var path: String?
    private(set) var sent: [PlannedStopEdit] = []
    let status: Int

    init(status: Int = 200) {
        self.status = status
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        method = request.method.rawValue
        path = request.url.path
        struct Body: Decodable { var stops: [PlannedStopEdit] }
        sent = request.body.flatMap { try? JSONDecoder().decode(Body.self, from: $0) }?.stops ?? []
        let room = #"{"id":"room-1","teamId":"t","athleteId":"a","name":"R","status":"active","createdAt":"2026-08-01T00:00:00.000Z","memberships":[],"entitlement":{"status":"active","lastUpdatedAt":"2026-08-01T00:00:00.000Z","source":"free"},"course":{"checkpoints":[{"id":"aid-1","latitude":1,"longitude":2,"plannedStopSeconds":600}]}}"#
        return HTTPResponse(status: status, body: Data((status == 200 ? room : #"{"error":"Insufficient permissions"}"#).utf8))
    }
}

private func graph(_ transport: StopsCaptureTransport) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: QuietLogger(),
        baseURL: URL(string: "https://example.invalid"),
        tokenProvider: StaticTokenProvider(token: "t")
    )
}

private struct QuietLogger: Logger {
    func log(_ message: String) {}
}

@Test func updatePlannedStopsPatchesOnlyTheEdits() async throws {
    let transport = StopsCaptureTransport()
    let room = try await RaceDayAPI.updatePlannedStops(
        graph: graph(transport),
        roomId: "room-1",
        edits: [PlannedStopEdit(checkpointId: "aid-1", plannedStopSeconds: 600)]
    )
    #expect(await transport.method == "PATCH")
    #expect(await transport.path == "/race-rooms/room-1/checkpoint-stops")
    #expect(await transport.sent == [PlannedStopEdit(checkpointId: "aid-1", plannedStopSeconds: 600)])
    #expect(room.course?.checkpoints.first?.plannedStopSeconds == 600)
}

@Test func updatePlannedStopsSurfacesServerRefusal() async {
    let transport = StopsCaptureTransport(status: 403)
    await #expect(throws: ClientHTTPError.self) {
        _ = try await RaceDayAPI.updatePlannedStops(
            graph: graph(transport),
            roomId: "room-1",
            edits: [PlannedStopEdit(checkpointId: "aid-1", plannedStopSeconds: 60)]
        )
    }
}

private func bridge(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(root["ok"] as? Bool == true, "\(raw)")
    return try #require(root["result"] as? [String: Any])
}

@Test func runtimeStopPlanDraftReplaysTypedMinutesForAndroid() async throws {
    let sheet = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
        CrewScheduleSheet(roomId: "room-1", raceStartAt: "2026-08-15T12:00:00.000Z", stops: stops)
    ))
    let result = try await bridge([
        "op": "stopPlanDraft",
        "checkpoints": [
            ["id": "start", "title": "Start", "distanceMetersFromStart": 0, "plannedStopSeconds": 0],
            ["id": "aid-1", "title": "Creek", "distanceMetersFromStart": 10 * mile, "plannedStopSeconds": 120],
            ["id": "aid-2", "title": "Ridge", "distanceMetersFromStart": 20 * mile, "plannedStopSeconds": 300],
            ["id": "finish", "title": "Finish", "distanceMetersFromStart": 30 * mile, "plannedStopSeconds": 0]
        ],
        "minutes": ["aid-1": "20", "aid-2": "x", "finish": "9"],
        "step": ["checkpointId": "aid-1", "deltaMinutes": 1],
        "progressMeters": 0,
        "role": "crew_chief",
        "sheet": sheet
    ])
    let rows = try #require(result["rows"] as? [[String: Any]])
    #expect(rows.map { $0["checkpointId"] as? String } == ["start", "aid-1", "aid-2", "finish"])
    #expect(rows[1]["stopLabel"] as? String == "21 MIN STOP", "typed 20 then one + tap")
    #expect(rows[1]["minutesText"] as? String == "21")
    #expect(result["mayEdit"] as? Bool == true)
    #expect(rows[2]["error"] as? String == "Enter whole minutes from 0 to 360.")
    #expect(rows[3]["draftSeconds"] as? Int == 0, "finish is locked")
    #expect(result["canSave"] as? Bool == false, "an invalid row blocks save")
    let edits = try #require(result["edits"] as? [[String: Any]])
    #expect(edits.count == 1)
    let projected = try #require(result["stops"] as? [[String: Any]])
    #expect(projected[2]["clockArrivalAt"] as? String == "2026-08-15T16:21:00.000Z")
    let timeline = try #require(result["timeline"] as? [[String: Any]])
    #expect(timeline[2]["clockArrivalAt"] as? String == "2026-08-15T16:21:00.000Z")
}

@Test func paceStopEditFixtureCopyMatchesTheChecklist() throws {
    let offline = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/pace-stop-edit?state=offline"))
    #expect(offline.accessibilityIdentifier == "crewcue.pace-stop-edit")
    #expect(offline.body == StopPlanCopy.offline)
    #expect(CrewCueClientCore.featureScreen(id: "pace-stop-edit", state: .success).body == "Planned stops saved.")
}

@Test func saveFailuresMapToSharedCopy() {
    #expect(StopPlanCopy.failure(URLError(.notConnectedToInternet)) == StopPlanCopy.offline)
    #expect(StopPlanCopy.failure(ClientHTTPError(status: 403, message: "Insufficient permissions")) == StopPlanCopy.forbidden)
    #expect(StopPlanCopy.failure(ClientHTTPError(status: 500, message: "boom")) == StopPlanCopy.failed)
}

@Test func runtimeUpdatePlannedStopsRejectsAnEmptySave() async throws {
    let data = try JSONSerialization.data(withJSONObject: ["op": "updatePlannedStops", "baseURL": "https://example.invalid", "roomId": "r", "stops": []])
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    #expect(raw.contains(#""ok":false"#))
    #expect(raw.contains("No stop changes to save."))
}
