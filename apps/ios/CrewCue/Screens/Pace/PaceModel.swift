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
    var delay: String?
    var line: String
}

@MainActor
@Observable
final class PaceModel {
    private let client: AppClient
    private var generation = 0
    private var userId: String?
    private var roomId: String?
    private(set) var role = ""

    private(set) var stopLines: [PaceLine] = []
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
    private(set) var gpxMessage = "Choose a route file."
    private(set) var gpxBusy = false

    private(set) var exportText = ""
    private(set) var exportMessage = "Nothing to export."

    var cutoffNote = ""
    var stoppageText = ""
    private(set) var cutoffLines: [PaceLine] = []
    private(set) var stoppageLines: [PaceLine] = []
    private(set) var courseMessage = "No course settings yet."

    private(set) var outboxRows: [PaceLine] = []
    private(set) var outboxMessage = "Outbox is empty."

    private var loadedStops: [ScheduleStop] = []
    private var loadedEstimate: PacingEstimate?
    private var courseCheckpoints: [RaceCourseCheckpoint] = []
    private var raceStartAt: String?
    private var scheduleRaceStart: String?
    private var plannedPaceSecondsPerKm: Double?
    private var historyRecord = EstimateHistoryRecord.empty
    private var historyEmpty = true
    private var usableFingerprint: String?
    private var courseOffline = false
    private var hasDraft = false
    private var didApplyDraft = false
    private var didLoadHistory = false

    var canRecalculate: Bool {
        PlanAuthority.mayExplicitRecalculate(role: role)
    }

    var canSeedColdStart: Bool {
        showColdStart && PlanAuthority.maySeedColdStart(role: role)
    }

    init(client: AppClient) {
        self.client = client
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

    func clear() {
        generation += 1
        userId = nil
        roomId = nil
        role = ""
        estimateBusy = false
        checkInBusy = false
        gpxBusy = false
        clearFields()
    }

    func recalculate() async {
        guard canRecalculate else { return }
        await computeAndAttach(ticket: generation)
    }

    func openCheckIn(checkpointId: String) {
        let trimmed = checkpointId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }
        self.checkpointId = trimmed
        checkInOpen = true
    }

    func seedColdStart() async {
        guard canSeedColdStart else { return }
        await computeAndAttach(ticket: generation)
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
            gpxMessage = "Choose a route file."
            return
        }
        guard let roomId, !gpxBusy else { return }
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
        let pace = (plannedPaceSecondsPerKm ?? 0) > 0 ? (plannedPaceSecondsPerKm ?? 360) : 360
        let start = raceAnchor ?? isoNow()
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
            } else {
                gpxMessage = "Couldn't read the route file."
            }
        }
    }

    func noteGpxReadFailure() {
        gpxMessage = "Couldn't read the route file."
    }

    func saveCourseDraft() {
        let note = cutoffNote.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawSeconds = stoppageText.trimmingCharacters(in: .whitespacesAndNewlines)
        let seconds: Double
        if rawSeconds.isEmpty {
            seconds = 0
        } else if let parsed = Double(rawSeconds), parsed.isFinite, parsed >= 0 {
            seconds = parsed
        } else {
            courseMessage = "Couldn't save course settings."
            return
        }
        guard let directory = userDirectory() else {
            courseMessage = "Couldn't save course settings."
            return
        }
        do {
            try CourseSettingsDraft.save(
                CourseSettingsDraft(cutoffNote: note, stoppageSeconds: seconds),
                directory: directory
            )
            hasDraft = true
            courseOffline = false
            courseMessage = "Cutoff and stoppage saved as a draft."
        } catch {
            courseMessage = "Couldn't save course settings."
        }
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
        guard ticket == generation, let roomId, let directory = userDirectory() else { return }
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
                applySheet(sheet, offline: offline, failed: offline == false)
            } else {
                applySheet(sheet, offline: false, failed: false)
            }
        } catch {
            guard ticket == generation else { return }
            applyScheduleFailure(error)
        }
    }

    private func loadCourseAndEstimate(ticket: Int, autoRecompute: Bool) async {
        guard ticket == generation, let roomId else { return }
        if didLoadHistory == false {
            loadHistoryRecord()
            didLoadHistory = true
        }
        loadDraftIfNeeded()
        let envelope: RoomEnvelope
        do {
            envelope = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId)
        } catch {
            guard ticket == generation else { return }
            courseOffline = APIFailure.isTransport(error)
            showColdStart = false
            estimateMessage = courseOffline
                ? "Offline. Estimate not updated."
                : "Couldn't load the pace estimate."
            return
        }
        guard ticket == generation else { return }
        courseOffline = false
        let room = envelope.room
        courseCheckpoints = room.course?.checkpoints ?? []
        raceStartAt = room.raceStartAt
        plannedPaceSecondsPerKm = room.plannedPaceSecondsPerKm
        loadedEstimate = room.pacingEstimate
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
        await computeAndAttach(ticket: ticket)
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

    private func computeAndAttach(ticket: Int) async {
        guard ticket == generation, let roomId, estimateBusy == false else { return }
        estimateBusy = true
        defer { estimateBusy = false }
        do {
            let graph = client.graph
            let computed = try await RaceDayAPI.computeEstimate(graph: graph, roomId: roomId)
            guard ticket == generation else { return }
            let attached = try await RaceDayAPI.attachEstimate(
                graph: graph,
                roomId: roomId,
                estimateId: computed.id
            )
            guard ticket == generation else { return }
            loadedEstimate = attached
            if let usableFingerprint {
                historyRecord = EstimateHistoryRecord(estimateId: attached.id, fingerprint: usableFingerprint)
                persistHistory()
            }
            applyEstimatePresentation()
            await loadScheduleSection(ticket: ticket)
        } catch {
            guard ticket == generation else { return }
            showColdStart = false
            estimateMessage = APIFailure.isTransport(error)
                ? "Offline. Estimate not updated."
                : "Couldn't load the pace estimate."
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
        loadedStops = sheet.stops
        scheduleRaceStart = sheet.raceStartAt
        if checkpointId.isEmpty, let first = sheet.stops.first?.checkpointId, first.isEmpty == false {
            checkpointId = first
        }
        let rows = sheet.stops.enumerated().map { index, stop in
            let title = ScheduleFormat.checkpointDisplayTitle(
                id: stop.checkpointId,
                title: courseTitle(for: stop.checkpointId)
            )
            let duration = ScheduleFormat.formatDurationSeconds(stop.elapsedSeconds)
            let clock = ScheduleFormat.formatUtcHhMm(stop.clockArrivalAt)
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
                delay: stop.delayOverrideSeconds.map { ScheduleFormat.formatDurationSeconds($0) },
                line: "\(title)  \(duration)  \(clock)"
            )
        }
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
    }

    private func applyScheduleFailure(_ error: Error) {
        loadedStops = []
        stopLines = []
        stops = []
        let offline = APIFailure.isTransport(error)
        scheduleOffline = offline
        scheduleMessage = offline
            ? "Offline. Schedule not updated. The last sheet stays readable on this device."
            : "Couldn't load the schedule."
        exportText = ""
        exportMessage = "Couldn't build the crew sheet."
    }

    private func applyExport(roomId: String, offline: Bool, failed: Bool) {
        if stopLines.isEmpty {
            exportText = ""
            exportMessage = failed ? "Couldn't build the crew sheet." : "Nothing to export."
            return
        }
        let captured = ScheduleFormat.formatUtcHhMm(isoNow())
        var rows = ["Crew sheet", "Captured \(captured)", "Room \(roomId)"]
        rows.append(contentsOf: stopLines.map(\.text))
        exportText = rows.joined(separator: "\n")
        if offline {
            exportMessage = "Offline. Crew sheet is ready to share from this device."
        } else {
            exportMessage = ""
        }
    }

    private func applyEstimatePresentation() {
        if let loadedEstimate, loadedEstimate.coldStart == false, historyEmpty == false {
            showColdStart = false
            let duration = ScheduleFormat.formatDurationSeconds(loadedEstimate.expectedFinishElapsedSeconds)
            let clock = ScheduleFormat.formatUtcHhMm(loadedEstimate.expectedFinishAt)
            estimateMessage = "\(loadedEstimate.explanation) \(duration) \(clock)"
            return
        }
        if loadedEstimate == nil, historyEmpty == false {
            showColdStart = false
            estimateMessage = "No estimate yet."
            return
        }
        showColdStart = true
        estimateMessage = "Cold start: no history yet. Coarse estimate only."
    }

    private func refreshCourseReadout() {
        stoppageLines = courseCheckpoints.compactMap { checkpoint in
            guard let seconds = checkpoint.plannedStopSeconds else { return nil }
            let title = ScheduleFormat.checkpointDisplayTitle(id: checkpoint.id, title: checkpoint.title)
            return PaceLine(
                id: "stoppage-\(checkpoint.id)",
                text: "\(title) \(ScheduleFormat.formatDurationSeconds(seconds))"
            )
        }
        cutoffLines = loadedStops.compactMap { stop in
            guard let status = stop.cutoffStatus, status.isEmpty == false else { return nil }
            let title = ScheduleFormat.checkpointDisplayTitle(
                id: stop.checkpointId,
                title: courseTitle(for: stop.checkpointId)
            )
            let margin = stop.cutoffMarginSeconds.map { ScheduleFormat.formatDurationSeconds($0) }
            let text = margin.map { "\(title) \(status) \($0)" } ?? "\(title) \(status)"
            return PaceLine(id: "cutoff-\(stop.id)", text: text)
        }
        if courseOffline {
            courseMessage = "Offline. Course settings stay on this device."
            return
        }
        if hasDraft {
            courseMessage = "Cutoff and stoppage saved as a draft."
            return
        }
        if stoppageLines.isEmpty, cutoffLines.isEmpty {
            courseMessage = "No course settings yet."
        } else {
            courseMessage = ""
        }
    }

    private func refreshOutbox(offline: Bool) async {
        guard let outbox = client.graph.outbox else {
            outboxRows = []
            outboxMessage = "Outbox is empty."
            return
        }
        do {
            let operations = try await outbox.operations()
            let pending = operations.filter { $0.status == "pending" }
            outboxRows = pending.map { PaceLine(id: $0.id, text: "\($0.type) \($0.id)") }
            if operations.contains(where: { $0.status == "rejected" || $0.status == "conflict" }) {
                outboxMessage = "Rejected by server policy."
            } else if offline, pending.isEmpty == false {
                outboxMessage = "Network error. Will retry when the app is active."
            } else if pending.isEmpty {
                outboxMessage = "Outbox is empty."
            } else {
                outboxMessage = ""
            }
        } catch {
            outboxMessage = "Network error. Will retry when the app is active."
        }
    }

    private func fetchHistory() async throws -> [ActivityHistoryRef] {
        guard let baseURL = client.graph.baseURL, let url = APIClient.endpoint(baseURL, "/activity-history") else {
            return []
        }
        let token = await client.graph.tokenProvider?.accessToken()
        let request = APIClient.authorized(url: url, method: .get, token: token)
        let payload: ActivityHistoryListPayload = try await APIClient.send(request, transport: client.graph.transport)
        return payload.items.map { item in
            ActivityHistoryRef(
                id: item.id,
                distanceMeters: item.distanceMeters,
                elapsedSeconds: item.elapsedSeconds,
                elevationGainMeters: item.elevationGainMeters
            )
        }
    }

    private func resolvedCheckpointId() -> String {
        let trimmed = checkpointId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty == false {
            return trimmed
        }
        return loadedStops.first?.checkpointId ?? ""
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

    private func loadDraftIfNeeded() {
        guard didApplyDraft == false else { return }
        didApplyDraft = true
        guard let directory = userDirectory() else { return }
        guard let draft = try? CourseSettingsDraft.load(directory: directory) else { return }
        cutoffNote = draft.cutoffNote
        stoppageText = formatStoppage(draft.stoppageSeconds)
        hasDraft = true
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
        guard let userId else { return nil }
        return try? AppDirectories.userDirectory(userId: userId)
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

    private func formatStoppage(_ seconds: Double) -> String {
        if seconds.rounded() == seconds {
            return String(Int(seconds))
        }
        return String(seconds)
    }

    private func clearFields() {
        stopLines = []
        stops = []
        checkInOpen = false
        scheduleMessage = ""
        scheduleOffline = false
        loadedStops = []
        estimateMessage = "No estimate yet."
        showColdStart = false
        loadedEstimate = nil
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
        gpxMessage = "Choose a route file."
        exportText = ""
        exportMessage = "Nothing to export."
        cutoffNote = ""
        stoppageText = ""
        cutoffLines = []
        stoppageLines = []
        courseMessage = "No course settings yet."
        courseOffline = false
        hasDraft = false
        didApplyDraft = false
        outboxRows = []
        outboxMessage = "Outbox is empty."
        courseCheckpoints = []
        raceStartAt = nil
        scheduleRaceStart = nil
        plannedPaceSecondsPerKm = nil
    }
}

private struct ActivityHistoryListPayload: Decodable {
    var items: [ActivityHistoryItemPayload]
}

private struct ActivityHistoryItemPayload: Decodable {
    var id: String
    var distanceMeters: Double?
    var elapsedSeconds: Double?
    var elevationGainMeters: Double?
}

private struct SavedEstimateHistory: Codable {
    var estimateId: String?
    var fingerprint: String?
}
