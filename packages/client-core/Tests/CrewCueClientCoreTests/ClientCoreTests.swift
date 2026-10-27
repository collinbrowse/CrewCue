import Foundation
import Testing
@testable import CrewCueClientCore

@Test func helloStampIsStable() {
    #expect(CrewCueClientCore.helloStamp() == "CrewCue")
}

@Test func durationFormattingMatchesMobileCases() {
    #expect(ScheduleFormat.formatDurationSeconds(0) == "00:00")
    #expect(ScheduleFormat.formatDurationSeconds(65) == "01:05")
    #expect(ScheduleFormat.formatDurationSeconds(600) == "10:00")
    #expect(ScheduleFormat.formatDurationSeconds(3599) == "59:59")
    #expect(ScheduleFormat.formatDurationSeconds(3600) == "1:00:00")
    #expect(ScheduleFormat.formatDurationSeconds(4200) == "1:10:00")
    #expect(ScheduleFormat.formatDurationSeconds(14700) == "4:05:00")
    #expect(ScheduleFormat.formatDurationSeconds(-1) == "—")
    #expect(ScheduleFormat.formatDurationSeconds(.nan) == "—")
}

@Test func scheduleClockRejectsInvalidISO() {
    #expect(ScheduleFormat.formatScheduleClock("not-a-date") == "—")
    #expect(ScheduleFormat.formatScheduleClock("2026-08-15T14:10:00.000Z") != "—")
    #expect(ScheduleFormat.formatUtcHhMm("2026-08-15T14:10:00.000Z") == "14:10 UTC")
}

@Test func scheduleSheetSuccessIncludesAidDuration() throws {
    let screen = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet"))
    #expect(screen.accessibilityIdentifier == "crewcue.schedule-sheet")
    #expect(screen.body.contains("1:10:00"))
    #expect(screen.body.contains("Aid 1"))
    #expect(screen.body.contains("Finish  5:50:00  18:50 UTC"))
}

@Test func scheduleSheetStates() throws {
    let empty = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet?state=empty"))
    #expect(empty.body == "No stops on this sheet.")
    let error = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet?state=error"))
    #expect(error.body == "Couldn't load the schedule.")
    let offline = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet?state=offline"))
    #expect(offline.body == "Offline. Schedule not updated.")
}

@Test func estimateRecomputeDetectsHistoryChange() {
    let first = EstimateRecompute.decide(
        EstimateRecomputeInput(
            canEdit: true,
            busy: false,
            estimateId: "est",
            coldStart: true,
            usableHistoryCount: 1,
            historyFingerprint: "a",
            record: .empty
        )
    )
    #expect(first.reason == .coldStartWithHistory)
    #expect(first.recompute)
    let next = EstimateRecompute.decide(
        EstimateRecomputeInput(
            canEdit: true,
            busy: false,
            estimateId: "est",
            coldStart: false,
            usableHistoryCount: 1,
            historyFingerprint: "b",
            record: first.nextRecord
        )
    )
    #expect(next.reason == .historyChanged)
}

@Test func outboxMergeAndRetry() {
    let first = OutboxOperation(id: "1", type: "ping", status: "pending", conflictKey: "ping")
    let replacement = OutboxOperation(id: "2", type: "ping", status: "pending", conflictKey: "other")
    let merged = OutboxPolicy.merge([first], replacement, conflictKey: "ping")
    #expect(merged.count == 1)
    #expect(merged[0].id == "2")
    #expect(OutboxPolicy.isSafeRetry(first))
    #expect(!OutboxPolicy.isSafeRetry(OutboxOperation(id: "3", type: "task", status: "pending", conflictKey: "t")))
    let rejected = OutboxPolicy.resolve(ClientHTTPError(status: 422, message: "no", decision: "rejected"))
    #expect(rejected.status == "rejected")
    #expect(rejected.feedback == "Rejected by server policy.")
}

@Test func checkInValidation() {
    if case .invalid(let message) = CheckIn.validate(arrivalAt: "", departureAt: "") {
        #expect(message == "Arrival and departure are required.")
    } else {
        Issue.record("expected empty check-in to fail")
    }
    if case .invalid(let message) = CheckIn.validate(arrivalAt: "2026-08-15T14:16:00.000Z", departureAt: "2026-08-15T14:10:00.000Z") {
        #expect(message == "Departure must be after arrival.")
    } else {
        Issue.record("expected reversed check-in to fail")
    }
    if case .ok = CheckIn.validate(arrivalAt: "2026-08-15T14:10:00.000Z", departureAt: "2026-08-15T14:16:00.000Z") {
    } else {
        Issue.record("expected a valid check-in")
    }
}

@Test func mentionsFindAda() {
    let tokens = Mentions.parse("See @Ada at aid 1", members: [MentionMember(userId: "u1", displayName: "Ada")])
    #expect(tokens.contains { if case .mention(let name, let userId) = $0 { return name == "Ada" && userId == "u1" }; return false })
}

@Test func healthFixtureRoundTrip() throws {
    let url = try #require(Bundle.module.url(forResource: "health-status", withExtension: "json"))
    let data = try Data(contentsOf: url)
    let health = try APIClient.decodeHealth(data)
    #expect(health.service == "api")
    #expect(health.status == "ok")
    #expect(health.timestamp == "2026-09-23T00:00:00.000Z")
}

@Test func idempotencyKeyIsStable() {
    let key = IdempotencyKey.hashPayload(#"{"roomId":"room-fixture-50k"}"#)
    #expect(key == "be8f4ad54cf8204b")
    #expect(key == IdempotencyKey.hashPayload(#"{"roomId":"room-fixture-50k"}"#))
    #expect(key.count == 16)
    #expect(key != IdempotencyKey.hashPayload(#"{"roomId":"other"}"#))
}

@Test func portableHexEncodesBytesWithoutPrintf() {
    #expect(PortableFormat.hex([UInt8(0x00), 0x0a, 0xff, 0x10]) == "000aff10")
    #expect(PortableFormat.hex4(0x01) == "0001")
    #expect(PortableFormat.hex4(0x1f) == "001f")
    #expect(PortableFormat.hex(PortableSHA256.hash([])) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    #expect(PortableFormat.hex(PortableSHA256.hash(Array("abc".utf8))) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    #expect(ScheduleFormat.milesRemaining(progressMeters: 1000, checkpointDistanceMeters: 2609.344) == "1.0 mi")
}

@Test func deeplinkAliasForPaceEstimate() throws {
    let screen = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/pace-estimate?state=empty"))
    #expect(screen.featureId == "pace-estimate")
    #expect(screen.body == "No estimate yet.")
}

struct MockTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let body = try Data(contentsOf: Bundle.module.url(forResource: "health-status", withExtension: "json")!)
        return HTTPResponse(status: 200, body: body)
    }
}

actor HeaderCaptureTransport: HTTPTransport {
    private var captured: [(method: String, idempotency: String?)] = []

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        captured.append((request.method.rawValue, request.headers["Idempotency-Key"]))
        if request.url.path.hasSuffix("gpx-preview") {
            let json = #"{"course":{"checkpoints":[{"id":"a","latitude":1,"longitude":2},{"id":"b","latitude":3,"longitude":4}]},"plannedPaceSecondsPerKm":360,"courseFileName":"route.gpx"}"#
            return HTTPResponse(status: 200, body: Data(json.utf8))
        }
        return HTTPResponse(status: 200, body: Data(#"{}"#.utf8))
    }

    func putIdempotencyKey() -> String? {
        captured.first { $0.method == "PUT" }?.idempotency
    }
}

actor CourseImportTransport: HTTPTransport {
    private let failRoomGet: Bool
    private let roomJSON: String
    private var putBody: Data?

    init(failRoomGet: Bool = false, roomJSON: String? = nil) {
        self.failRoomGet = failRoomGet
        self.roomJSON = roomJSON ?? """
        {"room":{"id":"room","teamId":"team","athleteId":"athlete","name":"Race","status":"active","createdAt":"2026-08-01T00:00:00.000Z","raceStartAt":"2026-08-15T12:00:00.000Z","memberships":[],"entitlement":{"status":"paid","lastUpdatedAt":"2026-08-01T00:00:00.000Z","source":"manual"},"plannedPaceSecondsPerKm":720}}
        """
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if request.url.path.hasSuffix("gpx-preview") {
            let json = #"{"course":{"checkpoints":[{"id":"a","latitude":1,"longitude":2},{"id":"b","latitude":3,"longitude":4}]},"plannedPaceSecondsPerKm":360,"courseFileName":"route.gpx"}"#
            return HTTPResponse(status: 200, body: Data(json.utf8))
        }
        if request.method == .get {
            if failRoomGet {
                return HTTPResponse(status: 500, body: Data(#"{"error":"room get should not run"}"#.utf8))
            }
            return HTTPResponse(status: 200, body: Data(roomJSON.utf8))
        }
        putBody = request.body
        return HTTPResponse(status: 200, body: Data(#"{}"#.utf8))
    }

    func coursePut() -> (raceStartAt: String, pace: Double)? {
        guard let putBody,
              let object = try? JSONSerialization.jsonObject(with: putBody) as? [String: Any],
              let raceStartAt = object["raceStartAt"] as? String,
              let pace = (object["plannedPaceSecondsPerKm"] as? NSNumber)?.doubleValue else {
            return nil
        }
        return (raceStartAt, pace)
    }
}

@Test func fetchHealthUsesTransport() async throws {
    let health = try await APIClient.fetchHealth(baseURL: URL(string: "https://example.invalid")!, transport: MockTransport())
    #expect(health.service == "api")
}

@Test func routeParsesChecklistPathsAndState() {
    let cases: [(String, String)] = [
        ("crewcue://dev/hello", "hello"),
        ("crewcue://dev/schedule-sheet", "schedule-sheet"),
        ("crewcue://dev/cold-start", "cold-start"),
        ("crewcue://dev/pace-estimate", "pace-estimate"),
        ("crewcue://dev/crew-sheet-export", "crew-sheet-export"),
        ("crewcue://dev/outbox", "outbox-status"),
        ("crewcue://dev/auth-signed-out", "auth-sign-in"),
        ("crewcue://dev/join-crew", "join-crew"),
        ("crewcue://dev/athlete-setup", "athlete-setup"),
        ("crewcue://dev/onboarding-notifications", "onboarding-notifications"),
        ("crewcue://dev/check-in", "check-in"),
        ("crewcue://dev/pace-stop-edit", "pace-stop-edit"),
        ("crewcue://dev/course-settings", "course-settings"),
        ("crewcue://dev/readouts-incidents", "readouts-incidents"),
        ("crewcue://dev/gpx-import-progress", "gpx-import"),
        ("crewcue://dev/map", "map-track"),
        ("crewcue://dev/map-checkpoint-pick", "map-checkpoint-pick"),
        ("crewcue://dev/map-navigate", "map-navigate"),
        ("crewcue://dev/location-heartbeat", "location-heartbeat"),
        ("crewcue://dev/chat", "chat-thread"),
        ("crewcue://dev/chat-notification-prefs", "chat-notification-prefs"),
        ("crewcue://dev/push-registration", "push-registration"),
        ("crewcue://dev/profile", "profile"),
        ("crewcue://dev/room-members", "room-members"),
        ("crewcue://dev/strava", "strava"),
        ("crewcue://dev/app-shell", "app-shell"),
        ("crewcue://dev/loader", "brand-loader")
    ]
    for (url, featureId) in cases {
        let route = Route.parse(url)
        #expect(route?.featureId == featureId)
        #expect(route?.state == .success)
    }
    #expect(Route.parse("crewcue://dev/schedule-sheet?state=empty")?.state == .empty)
    #expect(Route.parse("crewcue://dev/schedule-sheet?state=error")?.state == .error)
    #expect(Route.parse("crewcue://dev/schedule-sheet?state=offline")?.state == .offline)
    #expect(Route.parse("crewcue://dev/schedule-sheet?state=nope")?.state == .success)
    #expect(Route.parse("https://example.invalid") == nil)
    #expect(Route.parse("crewcue://dev/not-a-feature") == nil)
}

@Test func userFacingErrorMapsClientHTTPError() {
    let rejected = UserFacingError(ClientHTTPError(status: 422, message: "no", decision: "rejected"))
    #expect(rejected.code == "rejected")
    #expect(rejected.message == "Rejected by server policy.")
    #expect(rejected.retryable == false)

    let unavailable = UserFacingError(ClientHTTPError(status: 503, message: "down"))
    #expect(unavailable.code == "503")
    #expect(unavailable.message == "down")
    #expect(unavailable.retryable == true)
}

struct SilentLogger: Logger {
    func log(_ message: String) {}
}

@Test func clientGraphLoadsRouteScreen() {
    let graph = ClientGraph(transport: MockTransport(), clock: SystemClock(), logger: SilentLogger())
    let screen = graph.featureScreen(for: Route(featureId: "hello", state: .success))
    #expect(screen.featureId == "hello")
    #expect(screen.accessibilityIdentifier == "crewcue.hello")
}

@Test func stalePingIsDroppedAndAlreadyExistsIsSuccess() {
    let stale = OutboxPolicy.resolve(ClientHTTPError(status: 422, message: "old", reason: "stale_recorded_at"))
    #expect(stale.status == "dropped")
    #expect(stale.retryable == false)
    let duplicate = OutboxPolicy.resolve(ClientHTTPError(status: 409, message: "already exists", reason: "already_exists"))
    #expect(duplicate.status == "accepted")
}

@Test func crewCannotAutoRecomputePlanOfRecord() {
    let input = EstimateRecomputeInput(
        canEdit: true,
        busy: false,
        estimateId: "est",
        coldStart: true,
        usableHistoryCount: 1,
        historyFingerprint: "a",
        record: .empty
    )
    let athlete = EstimateRecompute.decide(role: "athlete", input)
    #expect(athlete.recompute)
    let crew = EstimateRecompute.decide(role: "crew_member", input)
    #expect(!crew.recompute)
    #expect(PlanAuthority.mayExplicitRecalculate(role: "crew_chief"))
    #expect(PlanAuthority.maySeedColdStart(role: "crew_member"))
}

@Test func outboxKeepsWorkQueuedDuringFlush() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    let first = try await store.enqueuePing(
        roomId: "room",
        role: "athlete",
        latitude: 1,
        longitude: 2,
        recordedAt: "2026-08-15T14:10:00.000Z"
    )
    guard case .queued(let queued) = first else {
        Issue.record("expected the ping to queue")
        return
    }
    let crew = try await store.enqueuePing(roomId: "room", role: "crew_member", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:11:00.000Z")
    #expect(crew == .rejected("Only the athlete uploads location."))
    let stale = try await store.enqueuePing(roomId: "room", role: "athlete", latitude: 1, longitude: 2, recordedAt: "2026-08-15T14:09:00.000Z")
    #expect(stale == .rejected("recordedAt must increase."))

    let report = try await store.flush { operation in
        if operation.id == queued.id {
            _ = try? await store.enqueueCheckIn(
                roomId: "room",
                checkpointId: "aid-1",
                arrivalAt: "2026-08-15T14:10:00.000Z",
                departureAt: "2026-08-15T14:16:00.000Z",
                role: "athlete"
            )
        }
        return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Sent.")
    }
    #expect(report.accepted == [queued.id])
    let remaining = try await store.operations()
    #expect(remaining.contains { $0.type == "check-in" && $0.status == "pending" })
    try store.wipe()
}

@Test func gpxFlushSendsIdempotencyKeyOnCoursePut() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    let queued = try await store.enqueueGpx(
        roomId: "room",
        fileName: "route.gpx",
        gpxXml: "<gpx/>",
        raceStartAt: "2026-08-15T12:00:00.000Z",
        plannedPaceSecondsPerKm: 360,
        role: "athlete"
    )
    let transport = HeaderCaptureTransport()
    let graph = ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: StaticTokenProvider(token: "token"),
        outbox: store
    )
    let report = try await RaceDayAPI.flushOutbox(graph: graph)
    #expect(report.accepted == [queued.id])
    #expect(await transport.putIdempotencyKey() == queued.idempotencyKey)
    try store.wipe()
}

@Test func gpxImportKeepsTheRoomRaceClockWhenTheCallerHasNone() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = try OutboxStore(userId: "athlete-1", directory: directory)
    let queued = try await store.enqueueGpx(
        roomId: "room",
        fileName: "route.gpx",
        gpxXml: "<gpx/>",
        raceStartAt: "",
        plannedPaceSecondsPerKm: 0,
        role: "athlete"
    )
    let transport = CourseImportTransport()
    let graph = ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: StaticTokenProvider(token: "token"),
        outbox: store
    )
    let report = try await RaceDayAPI.flushOutbox(graph: graph)
    #expect(report.accepted == [queued.id])
    let put = await transport.coursePut()
    #expect(put?.raceStartAt == "2026-08-15T12:00:00.000Z")
    #expect(put?.pace == 720)

    let explicit = CourseImportTransport(failRoomGet: true)
    let explicitGraph = ClientGraph(
        transport: explicit,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: StaticTokenProvider(token: "token")
    )
    _ = try await RaceDayAPI.importGpx(
        graph: explicitGraph,
        roomId: "room",
        fileName: "route.gpx",
        gpxXml: "<gpx/>",
        raceStartAt: "2026-09-01T06:00:00.000Z",
        plannedPaceSecondsPerKm: 400
    )
    let kept = await explicit.coursePut()
    #expect(kept?.raceStartAt == "2026-09-01T06:00:00.000Z")
    #expect(kept?.pace == 400)
    try store.wipe()
}

@Test func androidGpxImportUploadsARoomThatHasNoClockYet() async throws {
    let bare = """
    {"room":{"id":"room","teamId":"team","athleteId":"athlete","name":"Race","status":"active","createdAt":"2026-08-01T00:00:00.000Z","memberships":[],"entitlement":{"status":"paid","lastUpdatedAt":"2026-08-01T00:00:00.000Z","source":"manual"}}}
    """
    let transport = CourseImportTransport(roomJSON: bare)
    RuntimeCall.setTransportForTests(transport)
    defer { RuntimeCall.setTransportForTests(nil) }
    let response = await RuntimeCall.perform(#"""
    {"op":"importGpx","baseURL":"https://example.invalid","roomId":"room","fileName":"route.gpx","gpxXml":"<gpx/>","role":"athlete"}
    """#)
    let object = try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any]
    #expect(object?["ok"] as? Bool == true)
    #expect((object?["result"] as? [String: Any])?["status"] as? String == "saved")
    let put = await transport.coursePut()
    #expect(put?.pace == 360)
    #expect(put?.raceStartAt.isEmpty == false)

    let stored = CourseImportTransport()
    RuntimeCall.setTransportForTests(stored)
    let kept = await RuntimeCall.perform(#"""
    {"op":"importGpx","baseURL":"https://example.invalid","roomId":"room","fileName":"route.gpx","gpxXml":"<gpx/>","role":"athlete"}
    """#)
    let keptObject = try JSONSerialization.jsonObject(with: Data(kept.utf8)) as? [String: Any]
    #expect(keptObject?["ok"] as? Bool == true)
    let keptPut = await stored.coursePut()
    #expect(keptPut?.raceStartAt == "2026-08-15T12:00:00.000Z")
    #expect(keptPut?.pace == 720)
}

@Test func chatMutationsDoNotDropConcurrentAppends() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
            try await store.mutate(roomId: "room") { operations in
                operations.append(StoredOperation(
                    id: "m1",
                    type: "chat",
                    conflictKey: "chat:m1",
                    roomId: "room",
                    payloadJSON: #"{"text":"one"}"#,
                    idempotencyKey: "k1",
                    clientMessageId: "m1",
                    role: "athlete"
                ))
            }
        }
        group.addTask {
            try await store.mutate(roomId: "room") { operations in
                operations.append(StoredOperation(
                    id: "m2",
                    type: "chat",
                    conflictKey: "chat:m2",
                    roomId: "room",
                    payloadJSON: #"{"text":"two"}"#,
                    idempotencyKey: "k2",
                    clientMessageId: "m2",
                    role: "athlete"
                ))
            }
        }
        try await group.waitForAll()
    }
    let operations = try await store.operations()
    #expect(Set(operations.map(\.id)) == ["m1", "m2"])
}

@Test func crashReclaimsSendingAndSignOutWipesStore() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let seeded = [StoredOperation(
        id: "stuck",
        type: "ping",
        status: "sending",
        conflictKey: "ping:room",
        roomId: "room",
        payloadJSON: "{}",
        idempotencyKey: "k",
        clientMessageId: "stuck",
        role: "athlete"
    )]
    try JSONEncoder().encode(seeded).write(to: directory.appendingPathComponent("outbox.json"))
    let store = try OutboxStore.shared(userId: "athlete-1", directory: directory)
    let reclaimed = try await store.operations()
    #expect(reclaimed.first?.status == "pending")
    let session = SessionController(session: ClientSession(userId: "athlete-1", role: "athlete"))
    let file = store.fileURL
    session.register(id: "outbox") {
        if FileManager.default.fileExists(atPath: file.path) {
            try FileManager.default.removeItem(at: file)
        }
    }
    try session.signOut()
    #expect(session.session == nil)
    #expect(!FileManager.default.fileExists(atPath: file.path))
}

@Test func actionGateSkipsWhenBusy() async throws {
    let gate = ActionGate()
    let started = try await gate.run(key: "map:center", policy: .ignoreIfBusy) {
        let second = try await gate.run(key: "map:center", policy: .ignoreIfBusy) {}
        #expect(second == false)
    }
    #expect(started)
}

@Test func actionGateReplaceKeepsTheNewCallBusy() async throws {
    let gate = ActionGate()
    do {
        _ = try await gate.run(key: "map", policy: .replace) { ticket in
            let replaced = try await gate.run(key: "map", policy: .replace) { _ in
                let skipped = try await gate.run(key: "map", policy: .lock) {}
                #expect(skipped == false)
                #expect(await gate.isBusy("map"))
            }
            #expect(replaced)
            #expect(ticket.isCancelled)
        }
        Issue.record("replaced action should fail")
    } catch is CancellationError {
        #expect(await gate.isBusy("map") == false)
    }
}

@Test func raceRoomFixtureDecodes() throws {
    let json = """
    {"id":"r1","teamId":"t","athleteId":"a","name":"Race","status":"active","createdAt":"2026-08-15T13:00:00.000Z","memberships":[{"userId":"a","role":"athlete","joinedAt":"2026-08-15T13:00:00.000Z"}],"entitlement":{"status":"paid","lastUpdatedAt":"2026-08-15T13:00:00.000Z","source":"manual"}}
    """
    let room = try JSONDecoder().decode(RaceRoom.self, from: Data(json.utf8))
    #expect(room.name == "Race")
    #expect(room.memberships.count == 1)
}

@Test func errorCatalogMatchesKnownKey() {
    #expect(ErrorCatalog.message("networkOffline").contains("offline"))
}

@Test func runtimeJoinOpsRequireBaseURL() async {
    let preview = await RuntimeCall.perform(#"{"op":"previewJoin","code":"123456"}"#)
    let join = await RuntimeCall.perform(#"{"op":"join","code":"123456"}"#)
    #expect(preview.contains("\"ok\":false"))
    #expect(join.contains("\"ok\":false"))
    #expect(!preview.contains("Unknown runtime op"))
    #expect(!join.contains("Unknown runtime op"))
}

