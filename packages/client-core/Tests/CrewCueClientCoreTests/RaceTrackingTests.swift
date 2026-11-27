import Foundation
import Testing
@testable import CrewCueClientCore

// Runner tracking: offline backlog, batch upload, the crew path, and live ETAs.

private func temporaryDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("tracking-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private let base = Date(timeIntervalSince1970: 1_785_000_000)

private func iso(_ secondsAfterBase: Double) -> String {
    RaceDayReadouts.iso8601(base.addingTimeInterval(secondsAfterBase))
}

private func enqueue(_ store: OutboxStore, count: Int, roomId: String = "room", from: Double = 0) async throws {
    for index in 0..<count {
        let result = try await store.enqueuePing(
            roomId: roomId,
            role: "athlete",
            latitude: 40 + Double(index) * 0.0002,
            longitude: -105,
            recordedAt: iso(from + Double(index) * 180)
        )
        guard case .queued = result else {
            Issue.record("ping \(index) was not queued")
            return
        }
    }
}

/// A batch endpoint that answers each point with the decision `decide` picks for its index.
private actor BatchServer: HTTPTransport {
    private(set) var paths: [String] = []
    private(set) var bodies: [Data] = []
    private let decide: @Sendable (Int) -> (decision: String, reason: String?)
    private let status: Int

    init(status: Int = 200, decide: @escaping @Sendable (Int) -> (decision: String, reason: String?) = { _ in ("accepted", nil) }) {
        self.status = status
        self.decide = decide
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let body = request.body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        paths.append(request.url.path)
        bodies.append(request.body ?? Data())
        guard status == 200 else {
            return HTTPResponse(status: status, body: Data(#"{"decision":"rejected","reason":"room_not_active","message":"Race room must be active"}"#.utf8))
        }
        let points = body["points"] as? [[String: Any]] ?? []
        let results: [[String: Any]] = points.enumerated().map { index, point in
            let (decision, reason) = decide(index)
            var row: [String: Any] = ["recordedAt": point["recordedAt"] ?? "", "decision": decision]
            if let reason { row["reason"] = reason }
            return row
        }
        let accepted = results.filter { ($0["decision"] as? String) == "accepted" }.count
        let response: [String: Any] = ["roomId": "room", "receivedAt": iso(0), "results": results, "acceptedCount": accepted]
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: response))
    }
}

private func graph(_ transport: any HTTPTransport, outbox: OutboxStore? = nil) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://api.test")!,
        outbox: outbox
    )
}

// MARK: Backlog outbox

@Test func offlineBacklogKeepsEveryPingAndFlushesInOneBatch() async throws {
    let store = try OutboxStore(userId: "athlete", directory: temporaryDirectory())
    try await enqueue(store, count: 40)
    #expect(try await store.operations().count == 40)

    let server = BatchServer()
    let report = try await RaceDayAPI.flushOutbox(graph: graph(server, outbox: store), uploadIntervalSeconds: 180)

    let paths = await server.paths
    #expect(paths == ["/race-rooms/room/pings/batch"])
    let body = try #require(try JSONSerialization.jsonObject(with: await server.bodies[0]) as? [String: Any])
    let points = body["points"] as? [[String: Any]] ?? []
    #expect(points.count == 40)
    #expect(points.first?["recordedAt"] as? String == iso(0))
    #expect((body["uploadIntervalSeconds"] as? NSNumber)?.intValue == 180)
    #expect(report.accepted.count == 40)
    #expect(try await store.operations().isEmpty)
}

@Test func batchSettlesEachPingFromItsOwnResult() async throws {
    let store = try OutboxStore(userId: "athlete", directory: temporaryDirectory())
    try await enqueue(store, count: 4)
    let server = BatchServer { index in
        [("accepted", nil), ("duplicate", nil), ("rejected", "stale_recorded_at"), ("rejected", "implausible_motion")][index]
    }
    let report = try await RaceDayAPI.flushOutbox(graph: graph(server, outbox: store))
    #expect(report.accepted.count == 2, "accepted and duplicate both finish the row")
    #expect(report.dropped.count == 1, "a stale sample is dropped, never retried")
    #expect(report.rejected.count == 1)
    let left = try await store.operations()
    #expect(left.count == 1)
    #expect(left.first?.status == "rejected")
    #expect(left.first?.recordedAt == iso(3 * 180))
}

@Test func aRejectedBatchRequestMarksEveryPingAndNetworkLossKeepsThemQueued() async throws {
    let rejectedStore = try OutboxStore(userId: "athlete", directory: temporaryDirectory())
    try await enqueue(rejectedStore, count: 3)
    let rejected = try await RaceDayAPI.flushOutbox(graph: graph(BatchServer(status: 422), outbox: rejectedStore))
    #expect(rejected.rejected.count == 3)

    struct Offline: HTTPTransport {
        func send(_ request: HTTPRequest) async throws -> HTTPResponse { throw URLError(.notConnectedToInternet) }
    }
    let offlineStore = try OutboxStore(userId: "athlete", directory: temporaryDirectory())
    try await enqueue(offlineStore, count: 3)
    let offline = try await RaceDayAPI.flushOutbox(graph: graph(Offline(), outbox: offlineStore))
    #expect(offline.pending.count == 3)
    #expect(try await offlineStore.operations().allSatisfy { $0.status == "pending" })
}

@Test func backlogSurvivesARelaunchAndFlushesAfterIt() async throws {
    let directory = temporaryDirectory()
    let before = try OutboxStore.shared(userId: "athlete", directory: directory)
    try await enqueue(before, count: 6)
    OutboxStore.forgetSharedStoreForTesting(directory: directory)

    let after = try OutboxStore.shared(userId: "athlete", directory: directory)
    let server = BatchServer()
    let report = try await RaceDayAPI.flushOutbox(graph: graph(server, outbox: after))
    #expect(report.accepted.count == 6)
    #expect(await server.paths.count == 1)
}

@Test func backlogCapDropsTheOldestSamplesFirst() async throws {
    let store = try OutboxStore(userId: "athlete", directory: temporaryDirectory(), pendingPingCap: 5)
    try await enqueue(store, count: 8)
    let kept = try await store.operations().compactMap(\.recordedAt)
    #expect(kept == (3..<8).map { iso(Double($0) * 180) })
}

@Test func pingBatchesSplitPerRoomAtTheServerLimitOldestFirst() {
    func op(_ room: String, _ seconds: Double) -> StoredOperation {
        StoredOperation(id: "\(room)-\(seconds)", type: "ping", conflictKey: "ping:\(room)", roomId: room,
                        payloadJSON: "{}", idempotencyKey: "k", clientMessageId: "c", recordedAt: iso(seconds), role: "athlete")
    }
    let many = (0..<1200).reversed().map { op("a", Double($0)) } + [op("b", 1), op("b", 0)]
    let batches = OutboxStore.pingBatches(many)
    #expect(batches.map(\.roomId) == ["a", "a", "a", "b"])
    #expect(batches.map(\.pings.count) == [500, 500, 200, 2])
    #expect(batches[0].pings.first?.recordedAt == iso(0))
    #expect(batches[3].pings.map(\.recordedAt) == [iso(0), iso(1)])
}

// MARK: Tracking settings and session

@Test func trackingSettingsDefaultToThreeMinutesAndRejectOddIntervals() throws {
    let directory = temporaryDirectory()
    #expect(TrackingSettings.load(userDirectory: directory).intervalSeconds == 180)
    try TrackingSettings(intervalSeconds: 300).save(userDirectory: directory)
    #expect(TrackingSettings.load(userDirectory: directory).intervalSeconds == 300)
    #expect(TrackingSettings(intervalSeconds: 7).intervalSeconds == 180)
}

@Test func trackingSessionPersistsUntilStopped() throws {
    let directory = temporaryDirectory()
    #expect(TrackingSession.load(userDirectory: directory) == nil)
    try TrackingSession(roomId: "room", startedAt: iso(0)).save(userDirectory: directory)
    #expect(TrackingSession.load(userDirectory: directory) == TrackingSession(roomId: "room", startedAt: iso(0)))
    try TrackingSession.clear(userDirectory: directory)
    #expect(TrackingSession.load(userDirectory: directory) == nil)
}

// MARK: Crew path

@Test func runnerTrackAppendsNewPointsOnlyAndSkipsUnreadableOnes() {
    var track = RunnerTrack.empty
    track.append(RaceRoomPingTrackResponse(roomId: "room", points: [
        AthleteTrackPoint(recordedAt: iso(0), latitude: 40, longitude: -105),
        AthleteTrackPoint(recordedAt: iso(180), latitude: 40.001, longitude: -105),
        AthleteTrackPoint(recordedAt: "yesterday", latitude: 40.002, longitude: -105),
        AthleteTrackPoint(recordedAt: iso(360), latitude: 140, longitude: -105)
    ]))
    #expect(track.points.count == 2)
    #expect(track.cursor == iso(180))
    // A replayed page plus one new point: only the new one is added.
    track.append(RaceRoomPingTrackResponse(roomId: "room", points: [
        AthleteTrackPoint(recordedAt: iso(180), latitude: 40.001, longitude: -105),
        AthleteTrackPoint(recordedAt: iso(540), latitude: 40.003, longitude: -105)
    ]))
    #expect(track.points.map(\.recordedAt) == [0, 180, 540].map { base.addingTimeInterval($0) })
    #expect(track.cursor == iso(540))
}

@Test func runnerTrackReadsPastPreStartPointsWithoutDrawingThem() {
    var track = RunnerTrack.empty
    // Test pings from home and the drive in, then the race.
    track.append(RaceRoomPingTrackResponse(roomId: "room", points: [
        AthleteTrackPoint(recordedAt: iso(0), latitude: 37.77, longitude: -122.42, preStart: true),
        AthleteTrackPoint(recordedAt: iso(180), latitude: 39.9, longitude: -105, preStart: true)
    ]))
    #expect(track.points.isEmpty, "a test ping is not the race's path")
    #expect(track.cursor == iso(180), "the next page starts after the test pings")
    track.append(RaceRoomPingTrackResponse(roomId: "room", points: [
        AthleteTrackPoint(recordedAt: iso(180), latitude: 39.9, longitude: -105, preStart: true),
        AthleteTrackPoint(recordedAt: iso(360), latitude: 40, longitude: -105),
        AthleteTrackPoint(recordedAt: iso(540), latitude: 40.001, longitude: -105, preStart: false)
    ]))
    #expect(track.points.map(\.recordedAt) == [360, 540].map { base.addingTimeInterval($0) })
    #expect(track.cursor == iso(540))
}

private actor TrackServer: HTTPTransport {
    private(set) var afters: [String?] = []
    private let all = (0..<5).map { iso(Double($0) * 180) }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let query = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let after = query.first { $0.name == "after" }?.value
        afters.append(after)
        let start = after.flatMap { a in all.firstIndex(of: a).map { $0 + 1 } } ?? 0
        let page = Array(all[start..<min(all.count, start + 2)])
        var body: [String: Any] = [
            "roomId": "room",
            "points": page.map { ["recordedAt": $0, "latitude": 40, "longitude": -105] }
        ]
        if start + 2 < all.count, let last = page.last { body["nextCursor"] = last }
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: body))
    }
}

@Test func refreshTrackPagesFromTheCursorUntilTheLastPage() async throws {
    let server = TrackServer()
    let track = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: .empty)
    #expect(track.points.count == 5)
    #expect(await server.afters == [nil, iso(180), iso(540)])
    let again = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: track)
    #expect(again == track)
}

/// Three stored pings at 0, 180 and 360 s, marked `preStart` against the room's start as it is now
/// (like the API, which re-marks the whole stored track when the start moves).
private actor MovableStartTrackServer: HTTPTransport {
    private(set) var afters: [String?] = []
    private var startSeconds: Double
    private let stored: [Double] = [0, 180, 360]

    init(startSeconds: Double) {
        self.startSeconds = startSeconds
    }

    func moveStart(to seconds: Double) {
        startSeconds = seconds
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let query = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let after = query.first { $0.name == "after" }?.value
        afters.append(after)
        let afterSeconds = after.flatMap { a in stored.first { iso($0) == a } }
        let page = stored.filter { afterSeconds == nil || $0 > afterSeconds! }
        let body: [String: Any] = [
            "roomId": "room",
            "raceStartAt": iso(startSeconds),
            "points": page.map { seconds -> [String: Any] in
                var point: [String: Any] = ["recordedAt": iso(seconds), "latitude": 40 + seconds / 100_000, "longitude": -105]
                if seconds < startSeconds { point["preStart"] = true }
                return point
            }
        ]
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: body))
    }
}

@Test func movingTheStartEarlierDrawsThePathReadPastAsPreStart() async throws {
    // The start was set 10 minutes late, so the first race pings read as pre-start and aren't drawn.
    let server = MovableStartTrackServer(startSeconds: 600)
    let before = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: .empty)
    #expect(before.points.isEmpty)
    // The owner corrects the start. The server now marks every stored ping as part of the race.
    await server.moveStart(to: 0)
    let after = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: before)
    #expect(after.points.map(\.recordedAt) == [0, 180, 360].map { base.addingTimeInterval($0) },
            "a phone that read the track before the start moved draws the same line as a fresh one")
    let fresh = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: .empty)
    #expect(after.points == fresh.points)
}

@Test func movingTheStartLaterDropsThePathThatIsNowPreStart() async throws {
    let server = MovableStartTrackServer(startSeconds: 0)
    let before = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: .empty)
    #expect(before.points.count == 3)
    // A delayed gun: the pings so far were taken before the new start.
    await server.moveStart(to: 600)
    let after = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: before)
    #expect(after.points.isEmpty, "points now marked pre-start are not the race's path")
    #expect(after.cursor == iso(360))
}

@Test func anUnchangedStartKeepsReadingFromTheCursor() async throws {
    let server = MovableStartTrackServer(startSeconds: 0)
    let before = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: .empty)
    let again = try await RaceDayAPI.refreshTrack(graph: graph(server), roomId: "room", track: before)
    #expect(again == before)
    #expect(await server.afters == [nil, iso(360)])
}

/// Android's `pingTrack` op: the phone sends back the start its path was read under, so a moved
/// start reads the path again and says `restarted`, like iOS's `refreshTrack`.
@Test func androidsTrackOpRestartsWhenTheStartMoves() async throws {
    let server = MovableStartTrackServer(startSeconds: 0)
    let baseURL = "https://track-\(UUID().uuidString.lowercased()).example.invalid"
    RuntimeCall.setTransportForTests(server, baseURL: baseURL)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: baseURL) }
    func pingTrack(_ extra: [String: Any]) async throws -> [String: Any] {
        let fields = ["op": "pingTrack", "baseURL": baseURL, "token": "t", "roomId": "room"].merging(extra) { $1 }
        let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
        let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        return try #require(root["result"] as? [String: Any])
    }
    let first = try await pingTrack([:])
    #expect((first["points"] as? [Any])?.count == 3)
    #expect(first["restarted"] as? Bool == false)
    #expect(first["raceStartAt"] as? String == iso(0))
    let cursor = try #require(first["cursor"] as? String)

    let same = try await pingTrack(["after": cursor, "raceStartAt": iso(0)])
    #expect(same["restarted"] as? Bool == false)
    #expect((same["points"] as? [Any])?.isEmpty == true)

    await server.moveStart(to: 200)
    let moved = try await pingTrack(["after": cursor, "raceStartAt": iso(0)])
    #expect(moved["restarted"] as? Bool == true, "the held path was read under the old start")
    #expect((moved["points"] as? [[String: Any]])?.map { $0["recordedAt"] as? String } == [iso(360)])
    #expect(moved["raceStartAt"] as? String == iso(200))

    // A phone that never sent a start (an older build's call) is not compared.
    let unknown = try await pingTrack(["after": cursor])
    #expect(unknown["restarted"] as? Bool == false)
}

// MARK: Live ETAs

private func core(
    etas: [(String, Double)],
    windows: [String: (Double, Double)] = [:],
    finishWindow: ArrivalWindowClock? = nil,
    finishCrossed: Bool = false
) -> RaceRoomProjectionCore {
    func split(_ id: String, _ meters: Double, crossed: String?) -> RaceCheckpointSplitRow {
        RaceCheckpointSplitRow(checkpointId: id, distanceMetersFromStart: meters, crossedAtRecordedAt: crossed,
                               plannedElapsedSecondsAtCross: meters, plannedStopSeconds: 0, visits: [])
    }
    return RaceRoomProjectionCore(
        roomId: "room",
        asOfPingId: "p",
        asOfRecordedAt: iso(3600),
        progressMeters: 6000,
        courseLengthMeters: 20_000,
        plannedPaceSecondsPerKm: 600,
        etaFinishPlanIso: iso(11_000),
        checkpointSplits: [
            split("start", 0, crossed: iso(0)),
            split("aid", 10_000, crossed: nil),
            split("finish", 20_000, crossed: finishCrossed ? iso(11_000) : nil)
        ],
        stoppageSummary: CheckpointStoppageSummary(totalPlannedStopSeconds: 0, totalActualStopSeconds: 0, remainingPlannedStopSeconds: 0),
        remainingCheckpointEtas: etas.map {
            RemainingCheckpointEta(
                checkpointId: $0.0, liveProjectedElapsedSeconds: $0.1, frozenPlanElapsedSeconds: $0.1, deltaSecondsVsFrozenPlan: 0,
                window: windows[$0.0].map { ArrivalWindowElapsed(earliestElapsedSeconds: $0.0, latestElapsedSeconds: $0.1) }
            )
        },
        etaFinishWindow: finishWindow
    )
}

@Test func liveProjectionMapsServerElapsedToClockTimes() throws {
    let live = try #require(LiveProjection(core: core(etas: [("aid", 5400), ("finish", 11_000)]), timeliness: nil))
    #expect(live.arrivals["aid"] == base.addingTimeInterval(5400))
    #expect(live.finishEtaAt == base.addingTimeInterval(11_000))
    #expect(live.degraded == false)
    #expect(live.finishCrossed == false)
    #expect(TrackingSession.shouldAutoStop(live) == false)

    // The finish readout follows the finish row's live arrival, not the older plan-anchored finish.
    let disagreeing = try #require(LiveProjection(core: core(etas: [("finish", 10_000)]), timeliness: nil))
    #expect(disagreeing.finishEtaAt == base.addingTimeInterval(10_000))
    let noRow = try #require(LiveProjection(core: core(etas: [("aid", 5400)]), timeliness: nil))
    #expect(noRow.finishEtaAt == base.addingTimeInterval(11_000))

    // Before the first real ping the server's placeholder projection is not a live ETA.
    var placeholder = core(etas: [("finish", 11_000)])
    placeholder.asOfPingId = "bootstrap"
    #expect(LiveProjection(core: placeholder, timeliness: nil) == nil)

    let finished = try #require(LiveProjection(core: core(etas: [], finishCrossed: true), timeliness: nil))
    #expect(TrackingSession.shouldAutoStop(finished))
}

@Test func timelineRowsShowLiveArrivalsAheadAndNoWindowUntilTheServerSendsOne() throws {
    let live = try #require(LiveProjection(core: core(etas: [("aid", 5400), ("finish", 11_000)]), timeliness: nil))
    let checkpoints: [AidStationCheckpoint] = [
        AidStationCheckpoint(id: "start", title: "Start", latitude: 40, longitude: -105, distanceMetersFromStart: 0),
        AidStationCheckpoint(id: "aid", title: "Aid", latitude: 40.09, longitude: -105, distanceMetersFromStart: 10_000),
        AidStationCheckpoint(id: "finish", title: "Finish", latitude: 40.18, longitude: -105, distanceMetersFromStart: 20_000)
    ]
    let rows = RaceDayReadouts.timeline(sheet: nil, checkpoints: checkpoints, progressMeters: 6000, live: live)
    let arrivals: [String?] = rows.map { $0.liveArrivalAt }
    let expected: [String?] = [nil, iso(5400), iso(11_000)]
    #expect(arrivals == expected)
    #expect(rows.allSatisfy { $0.arrivalWindowStartAt == nil && $0.arrivalWindowEndAt == nil })
}

@Test func serverWindowsMapOntoTimelineRowsAndTheFinishReadout() throws {
    let live = try #require(LiveProjection(
        core: core(etas: [("aid", 5400), ("finish", 11_000)], windows: ["aid": (4800, 6300), "finish": (9900, 12_600)]),
        timeliness: nil
    ))
    #expect(live.arrivalWindows["aid"] == base.addingTimeInterval(4800)...base.addingTimeInterval(6300))
    #expect(live.finishWindow == base.addingTimeInterval(9900)...base.addingTimeInterval(12_600))
    let checkpoints: [AidStationCheckpoint] = [
        AidStationCheckpoint(id: "start", title: "Start", latitude: 40, longitude: -105, distanceMetersFromStart: 0),
        AidStationCheckpoint(id: "aid", title: "Aid", latitude: 40.09, longitude: -105, distanceMetersFromStart: 10_000),
        AidStationCheckpoint(id: "finish", title: "Finish", latitude: 40.18, longitude: -105, distanceMetersFromStart: 20_000)
    ]
    let rows = RaceDayReadouts.timeline(sheet: nil, checkpoints: checkpoints, progressMeters: 6000, live: live)
    #expect(rows[1].arrivalWindowStartAt == iso(4800) && rows[1].arrivalWindowEndAt == iso(6300))
    let readout = RaceDayReadouts.withLive(
        RaceDayReadouts.make(sheet: nil, checkpoints: [], progressMeters: 6000, now: base, lastPingAt: nil),
        live: live
    )
    #expect(readout.finishWindowStartAt == iso(9900) && readout.finishWindowEndAt == iso(12_600))

    // A window only where the server sent one; an inverted one is ignored.
    let partial = try #require(LiveProjection(core: core(etas: [("aid", 5400), ("finish", 11_000)], windows: ["aid": (7000, 6000)]), timeliness: nil))
    #expect(partial.arrivalWindows.isEmpty && partial.finishWindow == nil)

    // No finish row: the finish readout uses the server's clock window with its plan finish.
    let clock = ArrivalWindowClock(earliestIso: iso(10_000), latestIso: iso(12_000))
    let noRow = try #require(LiveProjection(core: core(etas: [("aid", 5400)], finishWindow: clock), timeliness: nil))
    #expect(noRow.finishWindow == base.addingTimeInterval(10_000)...base.addingTimeInterval(12_000))
}

@Test func readoutCarriesTheLiveFinishAndMarksADegradedProjectionStale() throws {
    let timeliness = ProjectionTimeliness(projectionConfidence: "degraded", stalenessThresholdSeconds: 540, secondsSinceLastAcceptedPing: 1200, evaluatedAt: iso(4800))
    let live = try #require(LiveProjection(core: core(etas: [("finish", 11_000)]), timeliness: timeliness))
    let readout = RaceDayReadouts.withLive(
        RaceDayReadouts.make(sheet: nil, checkpoints: [], progressMeters: 6000, now: base, lastPingAt: nil),
        live: live
    )
    #expect(readout.finishEtaAt == iso(11_000))
    #expect(readout.finishWindowStartAt == nil)
    #expect(readout.liveEtaStale)
    let none = RaceDayReadouts.withLive(readout, live: nil)
    #expect(none.finishEtaAt == nil && none.liveEtaStale == false)
}
