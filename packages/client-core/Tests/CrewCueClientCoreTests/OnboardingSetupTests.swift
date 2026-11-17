import Foundation
import Testing
@testable import CrewCueClientCore

// Runner setup (clients/behavior/onboarding-runner-setup.md): the course save limit, course
// mismatch, the history comparison, the course preview and the locked teaser.

private func setupDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("setup-\(UUID().uuidString)", isDirectory: true)
}

private func setupGraph(_ transport: any HTTPTransport, outbox: OutboxStore? = nil) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: StaticTokenProvider(token: "token"),
        outbox: outbox
    )
}

private func estimateJSON(_ id: String, finish: String) -> String {
    #"{"id":"\#(id)","coldStart":false,"expectedFinishAt":"\#(finish)","expectedFinishElapsedSeconds":36000,"aidEtas":[],"explanation":"Plan"}"#
}

/// Answers by method and path, one scripted reply per call (the last repeats), and records each request.
private actor SetupServer: HTTPTransport {
    typealias Reply = (status: Int, body: String)
    private var replies: [String: [Reply]]
    private(set) var requests: [(key: String, body: String)] = []

    init(_ replies: [String: [Reply]]) {
        self.replies = replies
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let key = "\(request.method.rawValue) \(request.url.path)"
        requests.append((key, request.body.map { String(decoding: $0, as: UTF8.self) } ?? ""))
        guard var queue = replies[key], let next = queue.first else {
            return HTTPResponse(status: 404, body: Data(#"{"error":"Not found"}"#.utf8))
        }
        if queue.count > 1 {
            queue.removeFirst()
            replies[key] = queue
        }
        return HTTPResponse(status: next.status, body: Data(next.body.utf8))
    }

    func keys() -> [String] { requests.map(\.key) }
    func bodies(_ key: String) -> [String] { requests.filter { $0.key == key }.map(\.body) }
}

// MARK: 429 backoff on queued course uploads

@Test func tooManyRequestsStaysPendingAndIsMarkedThrottled() {
    let resolution = OutboxPolicy.resolve(ClientHTTPError(status: 429, message: "Too many requests", bodyError: "Too many requests"))
    #expect(resolution.status == "pending")
    #expect(resolution.retryable)
    #expect(resolution.throttled)
    #expect(OutboxPolicy.resolve(ClientHTTPError(status: 503, message: "Unavailable")).throttled == false)
    #expect(OutboxPolicy.resolve(URLError(.notConnectedToInternet)).throttled == false)
}

@Test func courseUploadBackoffDoublesFromTwoMinutesToHalfAnHour() {
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 1) == 120)
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 2) == 240)
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 3) == 480)
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 4) == 960)
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 5) == 1800)
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 40) == 1800)
    #expect(OutboxPolicy.courseUploadBackoffSeconds(failures: 0) == 120)
}

private actor SendLog {
    private(set) var ids: [String] = []
    func add(_ id: String) { ids.append(id) }
}

@Test func throttledCourseUploadWaitsOutItsBackoffWhileOtherRowsStillSend() async throws {
    let store = try OutboxStore(userId: "athlete-throttle", directory: setupDirectory())
    let gpx = try await store.enqueueGpx(
        roomId: "room", fileName: "course.gpx", gpxXml: "<gpx/>",
        raceStartAt: "2026-08-15T12:00:00.000Z", plannedPaceSecondsPerKm: 360, role: "athlete"
    )
    let log = SendLog()
    let throttled = OutboxPolicy.resolve(ClientHTTPError(status: 429, message: "Too many requests"))
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    // First 429: two minutes before the next try.
    let first = try await store.flush({ operation in
        await log.add(operation.id)
        return throttled
    }, now: start)
    #expect(first.pending == [gpx.id])
    #expect(await log.ids == [gpx.id])

    // A chat message queued meanwhile goes out on the next flush; the course upload waits.
    let chat = try await store.enqueueChat(roomId: "room", text: "On my way", clientMessageId: "chat-1", role: "athlete")
    let during = try await store.flush({ operation in
        await log.add(operation.id)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
    }, now: start.addingTimeInterval(60))
    #expect(during.pending == [gpx.id])
    #expect(during.accepted == [chat.id])
    #expect(await log.ids == [gpx.id, chat.id])

    // Past two minutes it goes again; a second 429 doubles the wait to four.
    _ = try await store.flush({ operation in
        await log.add(operation.id)
        return throttled
    }, now: start.addingTimeInterval(121))
    #expect(await log.ids == [gpx.id, chat.id, gpx.id])
    let stillWaiting = try await store.flush({ operation in
        await log.add(operation.id)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Route uploaded.")
    }, now: start.addingTimeInterval(121 + 200))
    #expect(stillWaiting.pending == [gpx.id])
    #expect(await log.ids.count == 3)

    // After the four minutes it lands and leaves the queue.
    let landed = try await store.flush({ operation in
        await log.add(operation.id)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Route uploaded.")
    }, now: start.addingTimeInterval(121 + 241))
    #expect(landed.accepted == [gpx.id])
    #expect(try await store.operations().isEmpty)
    try store.wipe()
}

@Test func backoffEndsOnTheFirstAnswerThatIsNotTooManyRequests() async throws {
    let store = try OutboxStore(userId: "athlete-throttle-reset", directory: setupDirectory())
    let gpx = try await store.enqueueGpx(
        roomId: "room", fileName: "course.gpx", gpxXml: "<gpx/>",
        raceStartAt: "2026-08-15T12:00:00.000Z", plannedPaceSecondsPerKm: 360, role: "athlete"
    )
    let log = SendLog()
    let start = Date(timeIntervalSince1970: 1_800_000_000)
    _ = try await store.flush({ _ in OutboxPolicy.resolve(ClientHTTPError(status: 429, message: "Too many requests")) }, now: start)
    // Past the wait, a network error: still pending, but no longer backing off.
    _ = try await store.flush({ _ in OutboxPolicy.resolve(URLError(.notConnectedToInternet)) }, now: start.addingTimeInterval(130))
    _ = try await store.flush({ operation in
        await log.add(operation.id)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Route uploaded.")
    }, now: start.addingTimeInterval(131))
    #expect(await log.ids == [gpx.id])
    try store.wipe()
}

@Test func throttledCourseUploadHoldsBackEveryRaceBecauseTheLimitIsTheUsers() async throws {
    let store = try OutboxStore(userId: "athlete-throttle-rooms", directory: setupDirectory())
    let roomA = try await store.enqueueGpx(
        roomId: "room-a", fileName: "a.gpx", gpxXml: "<gpx/>",
        raceStartAt: "2026-08-15T12:00:00.000Z", plannedPaceSecondsPerKm: 360, role: "athlete"
    )
    let roomB = try await store.enqueueGpx(
        roomId: "room-b", fileName: "b.gpx", gpxXml: "<gpx/>",
        raceStartAt: "2026-09-15T12:00:00.000Z", plannedPaceSecondsPerKm: 360, role: "athlete"
    )
    let log = SendLog()
    let throttled = OutboxPolicy.resolve(ClientHTTPError(status: 429, message: "Too many requests"))
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    // Room A's 429 holds room B's upload in the same flush: it would hit the same limit.
    let first = try await store.flush({ operation in
        await log.add(operation.id)
        return throttled
    }, now: start)
    #expect(await log.ids == [roomA.id])
    #expect(Set(first.pending) == [roomA.id, roomB.id])

    // Inside the two minutes, neither race's upload goes.
    let during = try await store.flush({ operation in
        await log.add(operation.id)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Route uploaded.")
    }, now: start.addingTimeInterval(90))
    #expect(Set(during.pending) == [roomA.id, roomB.id])
    #expect(await log.ids == [roomA.id])

    // After it, both go.
    let after = try await store.flush({ operation in
        await log.add(operation.id)
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Route uploaded.")
    }, now: start.addingTimeInterval(121))
    #expect(Set(after.accepted) == [roomA.id, roomB.id])
    #expect(try await store.operations().isEmpty)
    try store.wipe()
}

@Test func flushOutboxBacksOffAQueuedCourseUploadTheServerThrottled() async throws {
    let store = try OutboxStore(userId: "athlete-throttle-api", directory: setupDirectory())
    _ = try await store.enqueueGpx(
        roomId: "room", fileName: "course.gpx", gpxXml: "<gpx/>",
        raceStartAt: "2026-08-15T12:00:00.000Z", plannedPaceSecondsPerKm: 360, role: "athlete"
    )
    let server = SetupServer([
        "POST /race-rooms/room/course/gpx-preview": [(200, #"{"course":{"checkpoints":[{"id":"a","latitude":1,"longitude":2}]}}"#)],
        "PUT /race-rooms/room/course": [(429, #"{"error":"Too many requests"}"#)]
    ])
    let graph = setupGraph(server, outbox: store)
    let first = try await RaceDayAPI.flushOutbox(graph: graph)
    #expect(first.pending.count == 1)
    _ = try await RaceDayAPI.flushOutbox(graph: graph)
    _ = try await RaceDayAPI.flushOutbox(graph: graph)
    // One PUT: the two later flushes inside the backoff never sent it.
    #expect(await server.keys().filter { $0 == "PUT /race-rooms/room/course" }.count == 1)
    #expect(try await store.operations().count == 1)
    try store.wipe()
}

// MARK: course_mismatch and the history comparison

@Test func courseMismatchOnAttachRecomputesAndAttachesAgain() async throws {
    let server = SetupServer([
        "POST /pacing-estimates": [
            (200, estimateJSON("est-old", finish: "2026-08-15T22:00:00.000Z")),
            (200, estimateJSON("est-new", finish: "2026-08-15T22:30:00.000Z"))
        ],
        "PUT /race-rooms/room/pacing-estimate": [
            (400, #"{"error":"The estimate was computed for a different course length; compute a new one for this course","code":"course_mismatch"}"#),
            (200, #"{"roomId":"room","pacingEstimateId":"est-new","estimate":\#(estimateJSON("est-new", finish: "2026-08-15T22:30:00.000Z"))}"#)
        ]
    ])
    let attached = try await PlanOfRecord.recompute(graph: setupGraph(server), roomId: "room", role: "athlete", trigger: .auto, hasPlanOfRecord: false)
    #expect(attached.id == "est-new")
    #expect(await server.keys() == [
        "POST /pacing-estimates", "PUT /race-rooms/room/pacing-estimate",
        "POST /pacing-estimates", "PUT /race-rooms/room/pacing-estimate"
    ])
    let attaches = await server.bodies("PUT /race-rooms/room/pacing-estimate")
    #expect(attaches[1].contains(#""pacingEstimateId":"est-new""#))
}

@Test func otherAttachFailuresAreNotRetried() async throws {
    let server = SetupServer([
        "POST /pacing-estimates": [(200, estimateJSON("est", finish: "2026-08-15T22:00:00.000Z"))],
        "PUT /race-rooms/room/pacing-estimate": [(400, #"{"error":"Unknown pacingEstimateId","code":"invalid_estimate_id"}"#)]
    ])
    await #expect(throws: ClientHTTPError.self) {
        _ = try await PlanOfRecord.recompute(graph: setupGraph(server), roomId: "room", role: "athlete", trigger: .auto, hasPlanOfRecord: false)
    }
    #expect(await server.keys().count == 2)
    #expect(PlanOfRecord.isCourseMismatch(ClientHTTPError(status: 400, message: "x", decision: "course_mismatch", reason: "course_mismatch")))
    #expect(!PlanOfRecord.isCourseMismatch(ClientHTTPError(status: 409, message: "x", reason: "course_mismatch")))
}

@Test func historyComparisonComputesWithoutHistoryThenAttachesTheOneWithIt() async throws {
    let server = SetupServer([
        "POST /pacing-estimates": [
            (200, estimateJSON("est-cold", finish: "2026-08-15T10:15:00.000Z")),
            (200, estimateJSON("est-history", finish: "2026-08-15T09:42:00.000Z"))
        ],
        "PUT /race-rooms/room/pacing-estimate": [
            (200, #"{"roomId":"room","pacingEstimateId":"est-history","estimate":\#(estimateJSON("est-history", finish: "2026-08-15T09:42:00.000Z"))}"#)
        ]
    ])
    let comparison = try await PlanOfRecord.recomputeComparingHistory(graph: setupGraph(server), roomId: "room", role: "athlete")
    let computes = await server.bodies("POST /pacing-estimates")
    #expect(computes.count == 2)
    #expect(computes[0].contains(#""historyRefIds":[]"#))
    #expect(!computes[1].contains("historyRefIds"))
    let attaches = await server.bodies("PUT /race-rooms/room/pacing-estimate")
    #expect(attaches == [#"{"pacingEstimateId":"est-history","trigger":"auto"}"#])
    #expect(comparison.attached.id == "est-history")
    #expect(comparison.withoutHistory.id == "est-cold")
    let line = comparison.line(timeZone: TimeZone(identifier: "UTC")!, locale: Locale(identifier: "en_US"))
    #expect(line?.replacingOccurrences(of: "\u{202F}", with: " ") == "Finish 9:42 AM instead of 10:15 AM")
}

@Test func skippingHistoryAttachesAColdStartEvenWhenRunsWereImported() async throws {
    let server = SetupServer([
        "POST /pacing-estimates": [
            (200, estimateJSON("est-cold", finish: "2026-08-15T10:15:00.000Z")),
            (200, estimateJSON("est-cold-2", finish: "2026-08-15T10:16:00.000Z"))
        ],
        "PUT /race-rooms/room/pacing-estimate": [
            (400, #"{"error":"The estimate was computed for a different course length","code":"course_mismatch"}"#),
            (200, #"{"roomId":"room","pacingEstimateId":"est-cold-2","estimate":\#(estimateJSON("est-cold-2", finish: "2026-08-15T10:16:00.000Z"))}"#)
        ]
    ])
    let attached = try await PlanOfRecord.recomputeWithoutHistory(graph: setupGraph(server), roomId: "room", role: "athlete")
    #expect(attached.id == "est-cold-2")
    // Both computes, the course_mismatch retry included, use no history at all.
    let computes = await server.bodies("POST /pacing-estimates")
    #expect(computes.count == 2)
    #expect(computes.allSatisfy { $0.contains(#""historyRefIds":[]"#) && $0.contains(#""trigger":"auto""#) })
    await #expect(throws: PlanAuthorityError.self) {
        _ = try await PlanOfRecord.recomputeWithoutHistory(graph: setupGraph(SetupServer([:])), roomId: "room", role: "crew_member")
    }
}

@Test func historyComparisonLineIsNilWhenHistoryChangesNothingVisible() {
    let same = HistoryComparison(
        withoutHistory: PacingEstimate(id: "a", coldStart: true, expectedFinishAt: "2026-08-15T09:42:10.000Z", expectedFinishElapsedSeconds: 1, aidEtas: [], explanation: ""),
        attached: PacingEstimate(id: "b", coldStart: false, expectedFinishAt: "2026-08-15T09:42:40.000Z", expectedFinishElapsedSeconds: 1, aidEtas: [], explanation: "")
    )
    #expect(same.line(timeZone: TimeZone(identifier: "UTC")!) == nil)
}

@Test func historyComparisonIsRefusedForCrew() async {
    let server = SetupServer([:])
    await #expect(throws: PlanAuthorityError.self) {
        _ = try await PlanOfRecord.recomputeComparingHistory(graph: setupGraph(server), roomId: "room", role: "crew_chief")
    }
    #expect(await server.keys().isEmpty)
}

// MARK: Course preview

private let previewBody = """
{"course":{"checkpoints":[
  {"id":"start","title":"Start","latitude":39.0,"longitude":-120.0,"distanceMetersFromStart":0},
  {"id":"aid-1","title":"Aid 1","latitude":39.01,"longitude":-120.0,"distanceMetersFromStart":1112},
  {"id":"finish","title":"Finish","latitude":39.02,"longitude":-120.0,"distanceMetersFromStart":2224}
]},
"plannedPaceSecondsPerKm":420,
"routeOverlayLayer":{"id":"x","label":"course","visible":true,"sourceFileName":"course.gpx",
  "geometry":{"type":"LineString","coordinates":[[-120.0,39.0,1800],[-120.0,39.01,1900],[-120.0,39.02,1850]]}},
"courseFileName":"course.gpx"}
"""

@Test func coursePreviewReadsCheckpointsRouteAndElevation() throws {
    let preview = try CoursePreview(previewData: Data(previewBody.utf8), fileName: "picked.gpx")
    #expect(preview.courseFileName == "course.gpx")
    #expect(preview.checkpoints.map(\.id) == ["start", "aid-1", "finish"])
    #expect(preview.plannedPaceSecondsPerKm == 420)
    #expect(preview.route.count == 3)
    #expect(preview.route[1] == CourseRoutePoint(latitude: 39.01, longitude: -120.0, elevationMeters: 1900))
    // 0.02 degrees of latitude is about 2.22 km.
    #expect(abs(preview.lengthMeters - 2224) < 5)
    let elevation = try #require(preview.elevation)
    #expect(elevation.samples.count == 3)
    #expect(elevation.samples[0].distanceMeters == 0)
    #expect(abs(elevation.samples[2].distanceMeters - 2224) < 5)
    #expect(elevation.gainMeters(from: 0, to: 3000) == 100)
    #expect(OnboardingCopy.courseSummary(lengthMeters: preview.lengthMeters, checkpoints: preview.checkpoints.count) == "1.4 mi · 3 checkpoints")
}

@Test func coursePreviewWithoutARouteFallsBackToTheCheckpointsAndHasNoElevation() throws {
    let body = #"{"course":{"checkpoints":[{"id":"a","latitude":39.0,"longitude":-120.0},{"id":"b","latitude":39.01,"longitude":-120.0}]}}"#
    let preview = try CoursePreview(previewData: Data(body.utf8), fileName: "flat.gpx")
    #expect(preview.courseFileName == "flat.gpx")
    #expect(preview.route.isEmpty)
    #expect(abs(preview.lengthMeters - 1112) < 5)
    #expect(preview.elevation == nil)
    #expect(throws: (any Error).self) { try CoursePreview(previewData: Data(#"{"course":{"checkpoints":[]}}"#.utf8), fileName: "x") }
    #expect(ElevationProfile(route: [CourseRoutePoint(latitude: 1, longitude: 1, elevationMeters: 5)]) == nil)
}

@Test func coursePreviewSurvivesAJSONRoundTripForTheSetupDraft() throws {
    let preview = try CoursePreview(previewData: Data(previewBody.utf8), fileName: "picked.gpx")
    let decoded = try JSONDecoder().decode(CoursePreview.self, from: JSONEncoder().encode(preview))
    #expect(decoded == preview)
}

@Test func previewGpxPostsTheFileAndSavesNothing() async throws {
    let server = SetupServer(["POST /race-rooms/room/course/gpx-preview": [(200, previewBody)]])
    let preview = try await RaceDayAPI.previewGpx(graph: setupGraph(server), roomId: "room", fileName: "course.gpx", gpxXml: "<gpx/>")
    #expect(preview.checkpoints.count == 3)
    #expect(await server.keys() == ["POST /race-rooms/room/course/gpx-preview"])
    let body = try #require(await server.bodies("POST /race-rooms/room/course/gpx-preview").first)
    let object = try #require(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: String])
    #expect(object == ["gpxXml": "<gpx/>", "courseFileName": "course.gpx"])
}

// MARK: Projection teaser

private let teaserSheet = CrewScheduleSheet(
    roomId: "room",
    raceStartAt: "2026-08-15T12:00:00.000Z",
    stops: [
        ScheduleStop(id: "s-start", checkpointId: "start", clockArrivalAt: "2026-08-15T12:00:00.000Z", elapsedSeconds: 0, plannedStoppageSeconds: 0),
        ScheduleStop(id: "s-finish", checkpointId: "finish", clockArrivalAt: "2026-08-15T22:10:00.000Z", elapsedSeconds: 36600, plannedStoppageSeconds: 0)
    ],
    locked: TeaserLockedCheckpoints(checkpointIds: ["aid-1", "aid-2"])
)

private let teaserCourse = [
    AidStationCheckpoint(id: "finish", title: "Finish", latitude: 3, longitude: 3, distanceMetersFromStart: 30_000),
    AidStationCheckpoint(id: "aid-2", title: "Aid 2", latitude: 2, longitude: 2, distanceMetersFromStart: 20_000),
    AidStationCheckpoint(id: "start", title: "Start", latitude: 0, longitude: 0, distanceMetersFromStart: 0),
    AidStationCheckpoint(id: "aid-1", title: "Aid 1", latitude: 1, longitude: 1, distanceMetersFromStart: 10_000)
]

private func teaserProjection(finish: String, locked: [String]) -> RaceRoomProjectionCore {
    RaceRoomProjectionCore(
        roomId: "room", asOfPingId: "bootstrap", asOfRecordedAt: "2026-08-15T12:00:00.000Z",
        progressMeters: 0, courseLengthMeters: 30_000, plannedPaceSecondsPerKm: 600,
        etaFinishPlanIso: finish, checkpointSplits: [],
        stoppageSummary: CheckpointStoppageSummary(totalPlannedStopSeconds: 0, totalActualStopSeconds: 0, remainingPlannedStopSeconds: 0),
        locked: TeaserLockedCheckpoints(checkpointIds: locked)
    )
}

@Test func teaserTimelineListsLockedAidStationsInCourseOrderWithNoTimes() {
    let rows = RaceDayReadouts.timeline(sheet: teaserSheet, checkpoints: teaserCourse, progressMeters: 0, showLocked: true)
    #expect(rows.map(\.checkpointId) == ["start", "aid-1", "aid-2", "finish"])
    #expect(rows.map(\.locked) == [false, true, true, false])
    #expect(rows[1].clockArrivalAt == nil)
    #expect(rows[2].clockArrivalAt == nil)
    #expect(rows[3].clockArrivalAt == "2026-08-15T22:10:00.000Z")
    #expect(rows[3].isFinish)
    #expect(rows[0].state == .current)
}

@Test func timelineLeavesLockedStopsOutUnlessAsked() {
    let rows = RaceDayReadouts.timeline(sheet: teaserSheet, checkpoints: teaserCourse, progressMeters: 0)
    #expect(rows.map(\.checkpointId) == ["start", "finish"])
    #expect(rows.allSatisfy { !$0.locked })
}

@Test func teaserTimelineWithoutTheCoursePutsLockedStopsBetweenStartAndFinish() {
    let rows = RaceDayReadouts.timeline(sheet: teaserSheet, checkpoints: [], progressMeters: 0, showLocked: true)
    #expect(rows.map(\.checkpointId) == ["start", "aid-1", "aid-2", "finish"])
    #expect(rows.map(\.locked) == [false, true, true, false])
}

@Test func teaserFinishIsTheScheduleFinishRowThenTheProjectionThenTheEstimate() {
    let estimate = PacingEstimate(id: "e", coldStart: true, expectedFinishAt: "2026-08-15T23:00:00.000Z", expectedFinishElapsedSeconds: 1, aidEtas: [], explanation: "")
    let projection = teaserProjection(finish: "2026-08-15T22:20:00.000Z", locked: ["aid-2", "aid-3"])
    let full = OnboardingTeaser(sheet: teaserSheet, projection: projection, estimate: estimate)
    #expect(full.finishAt == "2026-08-15T22:10:00.000Z")
    #expect(full.lockedCheckpointIds == ["aid-1", "aid-2", "aid-3"])
    #expect(OnboardingTeaser(sheet: nil, projection: projection, estimate: estimate).finishAt == "2026-08-15T22:20:00.000Z")
    #expect(OnboardingTeaser(sheet: nil, projection: teaserProjection(finish: "", locked: []), estimate: estimate).finishAt == "2026-08-15T23:00:00.000Z")
    #expect(OnboardingTeaser(sheet: nil, projection: nil, estimate: nil).finishAt == nil)
}

@Test func projectionCoreKeepsLockedAndIsNilWithoutAProjection() async throws {
    let body = String(decoding: try JSONEncoder().encode(teaserProjection(finish: "2026-08-15T22:20:00.000Z", locked: ["aid-1"])), as: UTF8.self)
    let server = SetupServer(["GET /race-rooms/room/projection": [(200, body)]])
    let core = try await RaceDayAPI.projectionCore(graph: setupGraph(server), roomId: "room")
    #expect(core?.locked?.checkpointIds == ["aid-1"])
    let none = try await RaceDayAPI.projectionCore(graph: setupGraph(SetupServer([:])), roomId: "room")
    #expect(none == nil)
}

// MARK: Step failures

@Test func setupFailuresMapToTheChecklistCopy() {
    #expect(OnboardingSetupFailure.classify(URLError(.notConnectedToInternet)) == .offline)
    #expect(OnboardingSetupFailure.offline.message == "Offline. Setup needs the network. Your answers stay on this phone until you reconnect.")
    let limit = ClientHTTPError(status: 429, message: "Too many requests")
    #expect(OnboardingSetupFailure.classify(limit, courseSave: true) == .courseSaveLimit)
    #expect(OnboardingSetupFailure.courseSaveLimit.message == OnboardingCopy.courseSaveLimit)
    #expect(OnboardingSetupFailure.classify(limit) == .failed)
    let unpaid = APIClient.failure(status: 402, data: Data(#"{"error":"Race not unlocked","code":"room_unpaid"}"#.utf8))
    #expect(OnboardingSetupFailure.classify(unpaid) == .raceLocked)
    #expect(OnboardingSetupFailure.raceLocked.opensPaywall)
    #expect(OnboardingSetupFailure.classify(ClientHTTPError(status: 402, message: "Payment required")) == .failed)
    #expect(OnboardingSetupFailure.classify(ClientHTTPError(status: 500, message: "x")) == .failed)
    #expect(OnboardingSetupFailure.failed.message == "Couldn't save this step.")
    #expect(!OnboardingSetupFailure.failed.opensPaywall)
}

// MARK: Copy

@Test func setupControlCopyIsPlainAndReachesAndroid() async throws {
    let strings = [
        OnboardingCopy.chooserTitle, OnboardingCopy.chooserRunnerDetail, OnboardingCopy.chooserCrewDetail,
        OnboardingCopy.chooserSignIn, OnboardingCopy.createAccount, OnboardingCopy.signIn, OnboardingCopy.displayName,
        OnboardingCopy.continueLabel, OnboardingCopy.chooseCourseFile, OnboardingCopy.chooseAnotherCourseFile,
        OnboardingCopy.startLabel, OnboardingCopy.timeZoneLabel, OnboardingCopy.timeZoneSearch,
        OnboardingCopy.importPastRun, OnboardingCopy.skipHistory, OnboardingCopy.finishLabel,
        OnboardingCopy.coursePreviewLabel, OnboardingCopy.elevationProfileLabel, OnboardingCopy.loading,
        OnboardingCopy.back, OnboardingCopy.paywallNotNow, OnboardingCopy.tryAgain,
        OnboardingCopy.accountMenu, OnboardingCopy.signOut, OnboardingCopy.switchRace,
        OnboardingCopy.lockedAidRow, OnboardingCopy.lockedAidExplanation
    ]
    for text in strings {
        #expect(!text.isEmpty)
        #expect(!text.contains("!"), "\(text)")
    }
    #expect(OnboardingCopy.lockedAidExplanation == "Aid station times stay locked until you unlock the race.")
    let copy = OnboardingCopy.runtimeCopy
    #expect(copy["lockedAidRow"] as? String == OnboardingCopy.lockedAidRow)
    #expect(copy["skipHistory"] as? String == OnboardingCopy.skipHistory)
    #expect(copy["continueLabel"] as? String == OnboardingCopy.continueLabel)
    #expect(copy["paywallNotNow"] as? String == OnboardingCopy.paywallNotNow)
    #expect(copy["tryAgain"] as? String == OnboardingCopy.tryAgain)
    #expect(copy["signOut"] as? String == OnboardingCopy.signOut)
    #expect(copy["switchRace"] as? String == OnboardingCopy.switchRace)
    #expect(copy["accountMenu"] as? String == OnboardingCopy.accountMenu)
    #expect(OnboardingCopy.courseSummary(lengthMeters: 1609.344, checkpoints: 1) == "1.0 mi · 1 checkpoint")
}
