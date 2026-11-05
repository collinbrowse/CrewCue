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

// MARK: Live ETAs

private func core(etas: [(String, Double)], finishCrossed: Bool = false) -> RaceRoomProjectionCore {
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
            RemainingCheckpointEta(checkpointId: $0.0, liveProjectedElapsedSeconds: $0.1, frozenPlanElapsedSeconds: $0.1, deltaSecondsVsFrozenPlan: 0)
        }
    )
}

@Test func liveProjectionMapsServerElapsedToClockTimes() throws {
    let live = try #require(LiveProjection(core: core(etas: [("aid", 5400), ("finish", 11_000)]), timeliness: nil))
    #expect(live.arrivals["aid"] == base.addingTimeInterval(5400))
    #expect(live.finishEtaAt == base.addingTimeInterval(11_000))
    #expect(live.degraded == false)
    #expect(live.finishCrossed == false)
    #expect(TrackingSession.shouldAutoStop(live) == false)

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
