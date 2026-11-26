import Foundation
import Observation
import CrewCueClientCore

struct PaceLine: Identifiable, Equatable {
    var id: String
    var text: String
}

struct PaceStop: Identifiable, Equatable {
    var id: String
    var checkpointId: String
    var title: String
    var arrival: String
    var elapsed: String
    var moving: String?
    var waited: String?
    var stoppage: String
    /// Dwell rail label for the planned stop, e.g. "5 MIN STOP".
    var stopLabel: String
    var delay: String?
    var line: String
    /// "RACE 1:10:00": the planned race time at arrival, under the planned clock.
    var raceTime: String = ""
    /// "Planned arrival 2:10 PM, 1 hour 10 minutes into the race".
    var spokenArrival: String = ""
}

@MainActor
@Observable
final class PaceModel {
    private let client: AppClient
    /// The app's storage, or the onboarding replay's temporary directory.
    private let storage: ModelStorage
    private var generation = 0
    private var userId: String?
    private var roomId: String?
    private(set) var role = ""

    private(set) var stopLines: [PaceLine] = []
    private(set) var raceName = ""
    private(set) var stops: [PaceStop] = []
    var checkInOpen = false
    private(set) var scheduleMessage = ""
    private(set) var scheduleOffline = false

    private(set) var estimateMessage = "No estimate yet."
    private(set) var showColdStart = false
    private(set) var estimateBusy = false

    var arrivalAt = ""
    var departureAt = ""
    var checkpointId = ""
    private(set) var checkInMessage = ""
    private(set) var checkInBusy = false

    var gpxText = ""
    var gpxFileName = "course.gpx"
    private(set) var gpxMessage = RaceToolsCopy.courseFileHint
    private(set) var gpxBusy = false
    /// The race has started (`RaceLock`): its course can't be replaced, so GPX import shows why
    /// instead of its controls. Aid-station edits stay open.
    private(set) var courseLocked = false

    private(set) var exportText = ""
    private(set) var crewSheetRows: [CrewSheetRow] = []
    private(set) var exportMessage = PaceModel.exportEmpty

    private(set) var cutoffLines: [PaceLine] = []
    private(set) var stoppageLines: [PaceLine] = []
    /// One sentence about the aid station stops; `stoppageLines` lists them only when they differ.
    private(set) var stopSummary = ""
    private(set) var courseMessage = PaceModel.exportEmpty

    /// #250 Pace edit: planned stop minutes. Non-nil while editing; the timeline renders from it.
    private(set) var stopDraft: StopPlanDraft?
    private(set) var stopsMessage = ""
    private(set) var stopsBusy = false
    private var latestRunner = RunnerProgress.none

    private(set) var outboxRows: [PaceLine] = []
    private(set) var outboxMessage = RaceToolsCopy.outboxEmpty

    private var loadedStops: [ScheduleStop] = []
    /// The aid stations an unpaid race withholds (`locked` on the schedule), shown locked on the timeline.
    private var loadedLocked: TeaserLockedCheckpoints?
    private var loadedEstimate: PacingEstimate?
    /// The schedule as the server sent it (offline, the cached one): its finish row is the race's
    /// finish the estimate summary prints (`PlanFinish`).
    private var scheduleSheet: CrewScheduleSheet?
    /// The estimate card shows the summary (not an error or the cold start), so a schedule read
    /// moves its finish to the plan's finish row.
    private var showsEstimateSummary = false
    /// Bumped each time an estimate loads or attaches. Its summary waits for a schedule read that
    /// started at this revision, so the card prints one finish: the plan's (planned stops
    /// included), or the estimate's own when that read fails. Until then the card keeps what it
    /// showed.
    private var estimateRevision = 0
    /// The `estimateRevision` the latest finished schedule read started at.
    private var scheduleRevision = 0
    private var summaryAwaitsSchedule: Bool { scheduleRevision < estimateRevision }
    private var courseCheckpoints: [RaceCourseCheckpoint] = []
    private var raceStartAt: String?
    private var scheduleRaceStart: String?
    private var plannedPaceSecondsPerKm: Double?
    private var historyRecord = EstimateHistoryRecord.empty
    private var historyEmpty = true
    private var usableFingerprint: String?
    private var courseOffline = false
    private var didLoadHistory = false
    /// The room's attached estimate id. Crew may seed a cold start only while this is nil.
    private var planOfRecordId: String?

    private var hasPlanOfRecord: Bool {
        planOfRecordId != nil || loadedEstimate != nil
    }

    var canRecalculate: Bool {
        PlanAuthority.mayExplicitRecalculate(role: role)
    }

    /// The race this model has loaded, if any.
    var loadedRoomId: String? { roomId }

    var canEditStops: Bool {
        PlanAuthority.mayEditCourse(role: role) && courseCheckpoints.count >= 2 && loadedStops.isEmpty == false
    }

    var isEditingStops: Bool { stopDraft != nil }

    var canSeedColdStart: Bool {
        showColdStart && PlanAuthority.maySeedColdStart(role: role)
    }

    init(client: AppClient, storage: ModelStorage = .app) {
        self.client = client
        self.storage = storage
    }

    func activate(userId: String?, roomId: String?, role: String?) async {
        generation += 1
        let ticket = generation
        let nextUser = userId
        let trimmedRoom = roomId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextRoom = (trimmedRoom?.isEmpty == false) ? trimmedRoom : nil
        let nextRole = role ?? ""
        let contextChanged = nextUser != self.userId || nextRoom != self.roomId || nextRole != self.role
        self.userId = nextUser
        self.roomId = nextRoom
        self.role = nextRole
        guard nextUser != nil, nextRoom != nil else {
            clearFields()
            self.userId = nextUser
            self.roomId = nextRoom
            self.role = nextRole
            return
        }
        if contextChanged {
            clearFields()
            self.userId = nextUser
            self.roomId = nextRoom
            self.role = nextRole
        }
        await reload(ticket: ticket, autoRecompute: true)
    }

    /// The race was renamed from Profile: the header shows the new name without a reload.
    func noteRenamed(_ name: String) {
        raceName = name
    }

    func clear() {
        generation += 1
        userId = nil
        roomId = nil
        role = ""
        estimateBusy = false
        checkInBusy = false
        gpxBusy = false
        stopsBusy = false
        clearFields()
    }

    func recalculate() async {
        guard canRecalculate else { return }
        await computeAndAttach(ticket: generation, trigger: .recalculate)
    }

    /// Settings removed a run: re-read the runner's history so the stored fingerprint matches,
    /// then recalculate. True when the new estimate was attached.
    func recalculateAfterHistoryChange() async -> Bool {
        guard roomId != nil, canRecalculate else { return false }
        let ticket = generation
        await loadHistoryIfNeeded(ticket: ticket)
        return await computeAndAttach(ticket: ticket, trigger: .recalculate)
    }

    /// Stops the runner has passed (by the athlete's latest ping) stay read-only in the draft.
    func beginStopEdit() {
        guard canEditStops, stopsBusy == false else { return }
        let checkpoints = aidCheckpoints
        stopDraft = StopPlanDraft(checkpoints: checkpoints, progressMeters: latestRunner.progressMeters(checkpoints: checkpoints))
        stopsMessage = ""
    }

    /// The athlete's latest ping (from the shell's poll). Recorded even when not editing, so a draft opened
    /// later starts from it; while a draft is open, any stop the runner passed is locked.
    func runnerMoved(_ runner: RunnerProgress) {
        latestRunner = runner
        stopDraft?.lockPassed(progressMeters: runner.progressMeters(checkpoints: aidCheckpoints))
    }

    func cancelStopEdit() {
        guard stopsBusy == false else { return }
        stopDraft = nil
        stopsMessage = ""
    }

    func setStopMinutes(_ text: String, for checkpointId: String) {
        stopDraft?.setMinutes(text, for: checkpointId)
    }

    func stepStop(_ checkpointId: String, by deltaMinutes: Int) {
        stopDraft?.step(checkpointId, deltaMinutes: deltaMinutes)
    }

    /// Sends only the changed stops. On failure the draft stays open so nothing typed is lost.
    func saveStopEdit() async {
        let ticket = generation
        guard let roomId, let draft = stopDraft, draft.canSave, stopsBusy == false else { return }
        stopsBusy = true
        defer { stopsBusy = false }
        do {
            let room = try await RaceDayAPI.updatePlannedStops(graph: client.graph, roomId: roomId, edits: draft.edits)
            guard ticket == generation else { return }
            courseCheckpoints = room.course?.checkpoints ?? courseCheckpoints
            stopDraft = nil
            stopsMessage = StopPlanCopy.saved
            await loadScheduleSection(ticket: ticket)
            guard ticket == generation else { return }
            refreshCourseReadout()
        } catch {
            guard ticket == generation else { return }
            stopsMessage = StopPlanCopy.failure(error)
        }
    }

    func openCheckIn(checkpointId: String) {
        let trimmed = checkpointId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        self.checkpointId = trimmed
        checkInOpen = true
    }

    /// Seeding twice is a recalculation: once the room has a plan of record, crew may only Recalculate.
    func seedColdStart() async {
        guard canSeedColdStart else { return }
        await computeAndAttach(ticket: generation, trigger: hasPlanOfRecord ? .recalculate : .coldStart)
    }

    func submitCheckIn() async {
        let ticket = generation
        guard !checkInBusy else { return }
        guard let roomId else { return }
        switch CheckIn.validate(arrivalAt: arrivalAt, departureAt: departureAt) {
        case .invalid(let message):
            checkInMessage = message
            return
        case .ok:
            break
        }
        guard let outbox = client.graph.outbox else { return }
        let checkpoint = resolvedCheckpointId()
        checkInBusy = true
        defer { checkInBusy = false }
        do {
            let result = try await outbox.enqueueCheckIn(
                roomId: roomId,
                checkpointId: checkpoint,
                arrivalAt: arrivalAt,
                departureAt: departureAt,
                role: role
            )
            guard ticket == generation else { return }
            switch result {
            case .rejected(let message):
                checkInMessage = message
            case .queued(let operation):
                await flushCheckIn(operation, ticket: ticket)
            }
        } catch {
            guard ticket == generation else { return }
            checkInMessage = "Couldn't validate check-in times."
        }
    }

    func importGpx(fileName: String, xml: String) async {
        let ticket = generation
        let trimmed = xml.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            gpxMessage = RaceToolsCopy.courseFileHint
            return
        }
        guard let roomId, !gpxBusy, !courseLocked else { return }
        gpxText = trimmed
        gpxFileName = fileName.isEmpty ? "course.gpx" : fileName
        gpxBusy = true
        defer { gpxBusy = false }
        gpxMessage = CourseImportStage.reading.message
        await Task.yield()
        guard ticket == generation else { return }
        gpxMessage = CourseImportStage.parsing.message
        await Task.yield()
        guard ticket == generation else { return }
        gpxMessage = CourseImportStage.calculating.message
        // Empty start and a non-positive pace mean "not loaded yet". The import fills those
        // from the room so an offline or in-flight upload cannot move the race clock.
        let knownPace = plannedPaceSecondsPerKm ?? 0
        let pace = knownPace > 0 ? knownPace : 0
        let start = raceAnchor ?? ""
        do {
            _ = try await RaceDayAPI.importGpx(
                graph: client.graph,
                roomId: roomId,
                fileName: gpxFileName,
                gpxXml: trimmed,
                raceStartAt: start,
                plannedPaceSecondsPerKm: pace
            )
            guard ticket == generation else { return }
            gpxMessage = CourseImportStage.calculating.message
            await loadCourseAndEstimate(ticket: ticket, autoRecompute: false)
            guard ticket == generation else { return }
            await loadScheduleSection(ticket: ticket)
            guard ticket == generation else { return }
            refreshCourseReadout()
            await refreshOutbox(offline: false)
        } catch {
            guard ticket == generation else { return }
            if APIFailure.isTransport(error) {
                await queueGpx(roomId: roomId, fileName: gpxFileName, xml: trimmed, start: start, pace: pace, ticket: ticket)
                guard ticket == generation else { return }
                gpxMessage = "Offline. The file stays on this device until upload."
            } else if RaceLock.isLockedError(error) {
                // Locked since the room was read (the runner's first race ping).
                courseLocked = true
                gpxMessage = RaceLock.message
            } else {
                gpxMessage = "Couldn't read the route file."
            }
        }
    }

    func noteGpxReadFailure() {
        gpxMessage = "Couldn't read the route file."
    }

    private func reload(ticket: Int, autoRecompute: Bool) async {
        guard ticket == generation else { return }
        await loadCourseAndEstimate(ticket: ticket, autoRecompute: autoRecompute)
        guard ticket == generation else { return }
        await loadScheduleSection(ticket: ticket)
        guard ticket == generation else { return }
        refreshCourseReadout()
        await refreshOutbox(offline: scheduleOffline || courseOffline)
    }

    private func loadScheduleSection(ticket: Int) async {
        guard ticket == generation else { return }
        let revision = estimateRevision
        guard let roomId, let directory = userDirectory() else {
            // No schedule to read: a held summary prints the estimate's own finish.
            finishScheduleRead(revision)
            refreshEstimateSummary()
            return
        }
        let file = ScheduleCache.file(directory: directory)
        let before = modificationDate(file)
        do {
            let sheet = try await RaceDayAPI.loadSchedule(
                graph: client.graph,
                roomId: roomId,
                cacheDirectory: directory
            )
            guard ticket == generation else { return }
            let after = modificationDate(file)
            let servedFromCache = before != nil && before == after
            if servedFromCache {
                let offline = await probeOffline()
                guard ticket == generation else { return }
                finishScheduleRead(revision)
                applySheet(sheet, offline: offline, failed: offline == false)
            } else {
                finishScheduleRead(revision)
                applySheet(sheet, offline: false, failed: false)
            }
        } catch {
            guard ticket == generation else { return }
            let held = summaryAwaitsSchedule
            finishScheduleRead(revision)
            applyScheduleFailure(error)
            // The read failed: a held summary prints the estimate's own finish, once.
            if held { refreshEstimateSummary() }
        }
    }

    /// A schedule read that started at `revision` finished; an older read finishing late never
    /// holds the summary again.
    private func finishScheduleRead(_ revision: Int) {
        scheduleRevision = max(scheduleRevision, revision)
    }

    private func loadCourseAndEstimate(ticket: Int, autoRecompute: Bool) async {
        guard ticket == generation, let roomId else { return }
        if didLoadHistory == false {
            loadHistoryRecord()
            didLoadHistory = true
        }
        let envelope: RoomEnvelope
        do {
            envelope = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId)
        } catch {
            guard ticket == generation else { return }
            courseOffline = APIFailure.isTransport(error)
            showColdStart = false
            showsEstimateSummary = false
            estimateMessage = courseOffline
                ? "Offline. Estimate not updated."
                : "Couldn't load the pace estimate."
            return
        }
        guard ticket == generation else { return }
        courseOffline = false
        let room = envelope.room
        courseCheckpoints = room.course?.checkpoints ?? []
        raceName = room.name
        raceStartAt = room.raceStartAt
        courseLocked = RaceLock.isLocked(room)
        plannedPaceSecondsPerKm = room.plannedPaceSecondsPerKm
        loadedEstimate = room.pacingEstimate
        estimateRevision += 1
        planOfRecordId = room.pacingEstimateId ?? room.pacingEstimate?.id
        await loadHistoryIfNeeded(ticket: ticket)
        guard ticket == generation else { return }
        applyEstimatePresentation()
        guard autoRecompute, estimateBusy == false else { return }
        let input = EstimateRecomputeInput(
            canEdit: PlanAuthority.mayAutoRecompute(role: role),
            busy: false,
            estimateId: loadedEstimate?.id ?? room.pacingEstimateId,
            coldStart: loadedEstimate?.coldStart,
            usableHistoryCount: historyEmpty ? 0 : 1,
            historyFingerprint: usableFingerprint,
            record: historyRecord
        )
        let decision = EstimateRecompute.decide(role: role, input)
        guard decision.recompute else {
            historyRecord = decision.nextRecord
            persistHistory()
            return
        }
        await computeAndAttach(ticket: ticket, trigger: .auto)
    }

    private func loadHistoryIfNeeded(ticket: Int) async {
        guard PlanAuthority.mayAutoRecompute(role: role) else {
            let refs = loadedEstimate?.historyRefIds ?? []
            historyEmpty = loadedEstimate == nil || loadedEstimate?.coldStart == true || refs.isEmpty
            usableFingerprint = nil
            return
        }
        do {
            let history = try await fetchHistory()
            guard ticket == generation else { return }
            let usable = EstimateRecompute.usableActivityHistory(history)
            historyEmpty = usable.isEmpty
            usableFingerprint = usable.isEmpty ? nil : EstimateRecompute.usableHistoryFingerprint(history)
        } catch {
            guard ticket == generation else { return }
            usableFingerprint = nil
            let refs = loadedEstimate?.historyRefIds ?? []
            historyEmpty = refs.isEmpty || loadedEstimate?.coldStart == true
        }
    }

    @discardableResult
    private func computeAndAttach(ticket: Int, trigger: PlanTrigger) async -> Bool {
        guard ticket == generation, let roomId, estimateBusy == false else { return false }
        estimateBusy = true
        defer { estimateBusy = false }
        do {
            let attached = try await PlanOfRecord.recompute(
                graph: client.graph,
                roomId: roomId,
                role: role,
                trigger: trigger,
                hasPlanOfRecord: hasPlanOfRecord
            )
            guard ticket == generation else { return false }
            loadedEstimate = attached
            estimateRevision += 1
            planOfRecordId = attached.id
            if let usableFingerprint {
                historyRecord = EstimateHistoryRecord(estimateId: attached.id, fingerprint: usableFingerprint)
                persistHistory()
            }
            applyEstimatePresentation()
            await loadScheduleSection(ticket: ticket)
            return true
        } catch {
            guard ticket == generation else { return false }
            showColdStart = false
            showsEstimateSummary = false
            estimateMessage = APIFailure.isTransport(error)
                ? "Offline. Estimate not updated."
                : "Couldn't load the pace estimate."
            return false
        }
    }

    private func flushCheckIn(_ operation: StoredOperation, ticket: Int) async {
        do {
            let report = try await RaceDayAPI.flushOutbox(graph: client.graph)
            guard ticket == generation else { return }
            if report.pending.contains(operation.id) {
                checkInMessage = "Offline. Check-in queued in the outbox."
                await refreshOutbox(offline: true)
            } else if report.rejected.contains(operation.id) {
                checkInMessage = "Rejected by server policy."
                await refreshOutbox(offline: false)
            } else {
                checkInMessage = "Check-in queued."
                await refreshOutbox(offline: false)
                await loadScheduleSection(ticket: ticket)
                refreshCourseReadout()
            }
        } catch {
            guard ticket == generation else { return }
            checkInMessage = "Offline. Check-in queued in the outbox."
            await refreshOutbox(offline: true)
        }
    }

    private func queueGpx(
        roomId: String,
        fileName: String,
        xml: String,
        start: String,
        pace: Double,
        ticket: Int
    ) async {
        guard let outbox = client.graph.outbox else { return }
        do {
            _ = try await outbox.enqueueGpx(
                roomId: roomId,
                fileName: fileName,
                gpxXml: xml,
                raceStartAt: start,
                plannedPaceSecondsPerKm: pace,
                role: role
            )
        } catch {
            return
        }
        guard ticket == generation else { return }
        await refreshOutbox(offline: true)
    }

    private func applySheet(_ sheet: CrewScheduleSheet, offline: Bool, failed: Bool) {
        scheduleSheet = sheet
        loadedStops = sheet.stops
        loadedLocked = sheet.locked
        scheduleRaceStart = sheet.raceStartAt
        if checkpointId.isEmpty, let first = sheet.stops.first?.checkpointId, first.isEmpty == false {
            checkpointId = first
        }
        let rows = paceStops(sheet.stops)
        stops = rows
        stopLines = rows.map { PaceLine(id: $0.id, text: $0.line) }
        scheduleOffline = offline
        if offline {
            scheduleMessage = "Offline. Schedule not updated. The last sheet stays readable on this device."
        } else if failed {
            scheduleMessage = "Couldn't load the schedule."
        } else if sheet.stops.isEmpty {
            scheduleMessage = "No stops on this sheet."
        } else {
            scheduleMessage = ""
        }
        applyExport(roomId: sheet.roomId, offline: offline, failed: failed)
        refreshEstimateSummary()
        refreshCourseReadout()
    }

    /// Display rows for schedule stops (server sheet, or the draft projection while editing).
    private func paceStops(_ stops: [ScheduleStop]) -> [PaceStop] {
        stops.enumerated().map { index, stop in
            let title = ScheduleFormat.checkpointDisplayTitle(
                id: stop.checkpointId,
                title: courseTitle(for: stop.checkpointId)
            )
            let duration = ScheduleFormat.formatDurationSeconds(stop.elapsedSeconds)
            let clock = ScheduleFormat.formatScheduleClock(stop.clockArrivalAt)
            let moving = stop.movingElapsedSeconds.map { ScheduleFormat.formatDurationSeconds($0) }
            let waited = stop.movingElapsedSeconds.map {
                ScheduleFormat.formatDurationSeconds(max(0, stop.elapsedSeconds - $0))
            }
            return PaceStop(
                id: stop.id,
                checkpointId: stop.checkpointId,
                title: "\(index + 1). \(title)",
                arrival: clock,
                elapsed: duration,
                moving: moving,
                waited: waited,
                stoppage: ScheduleFormat.formatDurationSeconds(stop.plannedStoppageSeconds),
                stopLabel: StopPlanDraft.stopLabel(seconds: stop.plannedStoppageSeconds),
                delay: stop.delayOverrideSeconds.map { ScheduleFormat.formatDurationSeconds($0) },
                line: "\(title)  \(duration)  \(clock)",
                raceTime: RaceTimeCopy.caption(elapsedSeconds: stop.elapsedSeconds),
                spokenArrival: RaceTimeCopy.spokenArrival(clock: clock, elapsedSeconds: stop.elapsedSeconds)
            )
        }
    }

    /// Stops the Pace cards show: the draft projection while editing planned stops.
    var displayStops: [PaceStop] {
        guard let stopDraft else { return stops }
        return paceStops(stopDraft.projectedStops(loadedStops))
    }

    private func applyScheduleFailure(_ error: Error) {
        scheduleSheet = nil
        loadedStops = []
        loadedLocked = nil
        stopLines = []
        stops = []
        let offline = APIFailure.isTransport(error)
        scheduleOffline = offline
        // No sheet is cached here, so don't promise one.
        scheduleMessage = offline
            ? "Offline. Schedule not updated."
            : "Couldn't load the schedule."
        exportText = ""
        crewSheetRows = []
        exportMessage = "Couldn't build the crew sheet."
    }

    private func applyExport(roomId: String, offline: Bool, failed: Bool) {
        if stopLines.isEmpty {
            exportText = ""
            crewSheetRows = []
            exportMessage = failed ? "Couldn't build the crew sheet." : Self.exportEmpty
            return
        }
        let titles = Dictionary(
            courseCheckpoints.compactMap { checkpoint in checkpoint.title.map { (checkpoint.id, $0) } },
            uniquingKeysWith: { first, _ in first }
        )
        crewSheetRows = RaceToolsCopy.crewSheetRows(loadedStops, titles: titles)
        exportText = RaceToolsCopy.crewSheetText(raceName: raceName, capturedAtIso: isoNow(), rows: crewSheetRows)
        if offline {
            exportMessage = "Offline. Crew sheet is ready to share from this device."
        } else {
            exportMessage = ""
        }
    }

    private func applyEstimatePresentation() {
        if let loadedEstimate, loadedEstimate.coldStart == false, historyEmpty == false {
            showColdStart = false
            showsEstimateSummary = true
            // Printed once this estimate's schedule read is in, so the finish never moves from the
            // estimate's own to the plan's.
            guard summaryAwaitsSchedule == false else { return }
            // The race's one finish: the loaded schedule's finish row (planned stops included)
            // when that sheet is this estimate's plan, as the teaser and Android Pace show it;
            // else the estimate's own finish.
            estimateMessage = PlanFinish.estimateSummary(
                loadedEstimate,
                plan: PlanFinish.row(in: scheduleSheet, for: loadedEstimate),
                timeZone: DeviceTimeZone.current
            )
            return
        }
        showsEstimateSummary = false
        if loadedEstimate == nil, historyEmpty == false {
            showColdStart = false
            estimateMessage = "No estimate yet."
            return
        }
        showColdStart = true
        estimateMessage = "Cold start: no history yet. Coarse estimate only."
    }

    /// The schedule changed under a summary already on show: print its finish again.
    private func refreshEstimateSummary() {
        guard showsEstimateSummary else { return }
        applyEstimatePresentation()
    }

    private func refreshCourseReadout() {
        let titles = Dictionary(
            courseCheckpoints.compactMap { checkpoint in checkpoint.title.map { (checkpoint.id, $0) } },
            uniquingKeysWith: { first, _ in first }
        )
        let readout = RaceToolsCopy.courseReadout(loadedStops, titles: titles)
        stopSummary = loadedStops.isEmpty ? "" : readout.summary
        stoppageLines = readout.rows.enumerated().map { index, row in
            PaceLine(id: "stoppage-\(index)", text: "\(row.title)\t\(row.duration)")
        }
        cutoffLines = readout.cutoffs.enumerated().map { index, line in
            PaceLine(id: "cutoff-\(index)", text: line)
        }
        if loadedStops.isEmpty {
            courseMessage = courseOffline ? "Offline. No schedule saved on this phone yet." : PaceModel.exportEmpty
        } else {
            courseMessage = courseOffline ? "Offline. From the last schedule saved on this phone." : ""
        }
    }

    private func refreshOutbox(offline: Bool) async {
        guard let outbox = client.graph.outbox else {
            outboxRows = []
            outboxMessage = RaceToolsCopy.outboxEmpty
            return
        }
        do {
            let operations = try await outbox.operations()
            let pending = operations.filter { $0.status == "pending" }
            outboxRows = pending.map { PaceLine(id: $0.id, text: RaceToolsCopy.outboxLabel(type: $0.type)) }
            if operations.contains(where: { $0.status == "rejected" || $0.status == "conflict" }) {
                outboxMessage = RaceToolsCopy.outboxRejected
            } else if offline, pending.isEmpty == false {
                outboxMessage = RaceToolsCopy.outboxOffline
            } else if pending.isEmpty {
                outboxMessage = RaceToolsCopy.outboxEmpty
            } else {
                outboxMessage = ""
            }
        } catch {
            outboxMessage = RaceToolsCopy.outboxOffline
        }
    }

    static let exportEmpty = "No schedule yet. Import the course file to build one."

    private func fetchHistory() async throws -> [ActivityHistoryRef] {
        guard client.graph.baseURL != nil else { return [] }
        return try await RaceDayAPI.activityHistory(graph: client.graph)
    }

    private func resolvedCheckpointId() -> String {
        let trimmed = checkpointId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty == false {
            return trimmed
        }
        return loadedStops.first?.checkpointId ?? ""
    }

    /// Pace timeline rows for the course progress list, placed by the athlete's latest ping.
    /// `live` is the server's live projection; rows ahead carry its arrival next to the plan.
    func timeline(runner: RunnerProgress, live: LiveProjection? = nil) -> [CheckpointTimelineRow] {
        RaceDayReadouts.timeline(
            sheet: loadedSheet,
            checkpoints: aidCheckpoints,
            progressMeters: runner.progressMeters(checkpoints: aidCheckpoints),
            live: live,
            // An unpaid race lists its locked aid stations too, shown locked.
            showLocked: true
        )
    }

    func readout(runner: RunnerProgress, live: LiveProjection? = nil) -> RaceDayReadout {
        RaceDayReadouts.withLive(
            RaceDayReadouts.make(sheet: loadedSheet, checkpoints: aidCheckpoints, runner: runner, now: client.graph.clock.now()),
            live: live
        )
    }

    /// Display stop for a checkpoint, used for the check-in button and accessibility line.
    func stop(for checkpointId: String) -> PaceStop? {
        stops.first { $0.checkpointId == checkpointId }
    }

    /// The server sheet, or while editing stops, the sheet as it will read after saving.
    private var loadedSheet: CrewScheduleSheet? {
        guard loadedStops.isEmpty == false else { return nil }
        let stops = stopDraft?.projectedStops(loadedStops) ?? loadedStops
        return CrewScheduleSheet(roomId: roomId ?? "", raceStartAt: raceAnchor ?? "", stops: stops, locked: loadedLocked)
    }

    private var aidCheckpoints: [AidStationCheckpoint] {
        courseCheckpoints.map {
            AidStationCheckpoint(
                id: $0.id,
                title: $0.title,
                latitude: $0.latitude,
                longitude: $0.longitude,
                distanceMetersFromStart: $0.distanceMetersFromStart,
                plannedStopSeconds: $0.plannedStopSeconds
            )
        }
    }

    private func courseTitle(for checkpointId: String) -> String? {
        courseCheckpoints.first { $0.id == checkpointId }?.title
    }

    private var raceAnchor: String? {
        if let raceStartAt, raceStartAt.isEmpty == false {
            return raceStartAt
        }
        if let scheduleRaceStart, scheduleRaceStart.isEmpty == false {
            return scheduleRaceStart
        }
        return nil
    }

    private func loadHistoryRecord() {
        guard let directory = userDirectory() else {
            historyRecord = .empty
            return
        }
        let url = directory.appendingPathComponent("estimate-history.json")
        guard let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode(SavedEstimateHistory.self, from: data) else {
            historyRecord = .empty
            return
        }
        historyRecord = EstimateHistoryRecord(estimateId: saved.estimateId, fingerprint: saved.fingerprint)
    }

    private func persistHistory() {
        guard let directory = userDirectory() else { return }
        let saved = SavedEstimateHistory(estimateId: historyRecord.estimateId, fingerprint: historyRecord.fingerprint)
        guard let data = try? JSONEncoder().encode(saved) else { return }
        let url = directory.appendingPathComponent("estimate-history.json")
        try? data.write(to: url, options: .atomic)
    }

    private func userDirectory() -> URL? {
        guard let userId, let roomId else { return nil }
        return try? storage.roomDirectory(userId, roomId)
    }

    private func probeOffline() async -> Bool {
        guard let baseURL = client.graph.baseURL else { return true }
        do {
            _ = try await APIClient.fetchHealth(baseURL: baseURL, transport: client.graph.transport)
            return false
        } catch {
            return APIFailure.isTransport(error)
        }
    }

    private func modificationDate(_ url: URL) -> Date? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }

    private func isoNow() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: client.graph.clock.now())
    }

    private func clearFields() {
        stopLines = []
        stops = []
        checkInOpen = false
        scheduleMessage = ""
        scheduleOffline = false
        loadedStops = []
        loadedLocked = nil
        scheduleSheet = nil
        showsEstimateSummary = false
        estimateMessage = "No estimate yet."
        showColdStart = false
        loadedEstimate = nil
        planOfRecordId = nil
        historyEmpty = true
        usableFingerprint = nil
        historyRecord = .empty
        didLoadHistory = false
        arrivalAt = ""
        departureAt = ""
        checkpointId = ""
        checkInMessage = ""
        gpxText = ""
        gpxFileName = "course.gpx"
        gpxMessage = RaceToolsCopy.courseFileHint
        exportText = ""
        exportMessage = Self.exportEmpty
        stopDraft = nil
        stopsMessage = ""
        latestRunner = .none
        cutoffLines = []
        stoppageLines = []
        stopSummary = ""
        crewSheetRows = []
        courseMessage = PaceModel.exportEmpty
        courseOffline = false
        outboxRows = []
        outboxMessage = RaceToolsCopy.outboxEmpty
        courseCheckpoints = []
        raceStartAt = nil
        scheduleRaceStart = nil
        plannedPaceSecondsPerKm = nil
        courseLocked = false
    }
}

private struct SavedEstimateHistory: Codable {
    var estimateId: String?
    var fingerprint: String?
}
