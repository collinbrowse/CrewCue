import Foundation
import Network
import Observation
import CrewCueClientCore

/// The runner's phase 1 setup (clients/behavior/onboarding-runner-setup.md), one step at a time
/// in `OnboardingStep.runnerSetup` order. Every typed or picked value lives here (and in the
/// draft on disk), so a size change, a display switch or a relaunch keeps the step and its data.
@MainActor
@Observable
final class RunnerSetupModel {
    private let client: AppClient

    // MARK: Context, from the onboarding state

    private(set) var signedIn = false
    private(set) var userId: String?
    /// The race being set up. Nil until the course step creates it.
    private(set) var roomId: String?
    /// The runner's role in that race (`athlete`).
    private var role = "athlete"
    /// The first setup step the onboarding state has open.
    private(set) var serverStep: OnboardingStep = .account
    /// Ahead of `serverStep` only after a save the race list hasn't answered for yet, and from
    /// the course step to the start time (the course is saved with the start, so the server still
    /// reads the course step as open).
    private var localStep: OnboardingStep?
    private var draftStore: RunnerSetupDraftStore?
    private var draft = RunnerSetupDraft()
    private var generation = 0

    // MARK: Step state

    var displayName = ""
    private(set) var courseFileName: String?
    private(set) var courseXml: String?
    private(set) var coursePreview: CoursePreview?
    /// The start's wall-clock fields, edited in UTC so every local time (a daylight saving gap
    /// in the chosen zone included) can be picked and then checked by `RaceStartInput`.
    var startWallClock: Date = RunnerSetupModel.defaultWallClock() {
        didSet { if startWallClock != oldValue { saveStartDraft() } }
    }
    var timeZoneIdentifier: String = DeviceTimeZone.current.identifier {
        didSet { if timeZoneIdentifier != oldValue { saveStartDraft() } }
    }
    var showsZonePicker = false
    var zoneSearch = ""
    var importingCourse = false
    var importingHistory = false
    private(set) var historyLine: String?
    private(set) var historyMessage: String?
    /// A past run was imported (or was already there) during this history step.
    private(set) var historyImported = false
    /// An estimate was attached during this history step (after an import).
    private var historyAttached = false
    private(set) var teaser: OnboardingTeaser?
    private(set) var teaserRows: [CheckpointTimelineRow] = []
    private(set) var teaserCheckpoints: [AidStationCheckpoint] = []
    /// A teaser load finished (with or without a finish), so a missing finish means "try again".
    private var teaserAttempted = false
    private(set) var busy = false
    private(set) var failure: OnboardingSetupFailure?

    // MARK: Hooks to the shell

    /// The course step created the race.
    var onRaceCreated: @MainActor (String) -> Void = { _ in }
    /// A server step saved: reload the race list so the onboarding state follows.
    var onServerStepSaved: @MainActor () async -> Void = {}
    /// The teaser read the room body (`GET /race-rooms/:roomId`) as the server sent it: the
    /// replay after setup plays from it.
    var onRoomLoaded: @MainActor (_ roomId: String, _ body: Data) -> Void = { _, _ in }
    var onMark: @MainActor (OnboardingStep, OnboardingOutcome, String?) -> Void = { _, _, _ in }
    var onDisplayName: @MainActor (String) -> Void = { _ in }
    var onSignUp: @MainActor () -> Void = {}
    var onSignIn: @MainActor () -> Void = {}
    var onPaywall: @MainActor () -> Void = {}
    /// Back to the chooser (only before a race exists).
    var onBack: @MainActor () -> Void = {}

    /// Past runs go through the same import as Settings (`POST /activity-history/file`).
    let activityImport: ActivityImportModel
    /// The Auth0 sign-in the account step starts, read for its busy state and failure.
    private let auth: AuthSignInModel?

    init(client: AppClient, activityImport: ActivityImportModel, auth: AuthSignInModel? = nil) {
        self.client = client
        self.activityImport = activityImport
        self.auth = auth
    }

    // MARK: Following the onboarding state

    /// Called whenever the onboarding state changes. `state` is the runner flow's when it is in
    /// setup; the dev route passes whatever state there is.
    func follow(state: OnboardingState, signedIn: Bool, userId: String?, displayName: String?, race: OnboardingRace?) {
        let userChanged = userId != self.userId || signedIn != self.signedIn
        if userChanged {
            reset()
            self.signedIn = signedIn
            self.userId = userId
            draftStore = signedIn ? userId.flatMap(RunnerSetupDraftStore.forUser) : nil
            draft = draftStore?.load() ?? RunnerSetupDraft()
            courseXml = draftStore?.loadCourse()
            applyDraft(fallbackName: displayName)
        }
        if let race { role = race.role }
        let stateRoom = state.flow == .runner ? state.roomId : nil
        if let stateRoom, stateRoom != roomId {
            adoptRoom(stateRoom)
        } else if roomId == nil, let saved = draft.roomId, signedIn {
            // Created here, but the race list hasn't listed it yet.
            roomId = saved
        }
        serverStep = Self.firstOpenSetupStep(state, signedIn: signedIn)
        if let localStep, Self.order(localStep) <= Self.order(serverStep) {
            self.localStep = nil
        }
        if serverStep == .startTime || serverStep == .course, draft.courseConfirmed, draft.roomId == roomId, coursePreview != nil {
            localStep = .startTime
        }
    }

    /// The step on screen.
    var step: OnboardingStep {
        guard let localStep, Self.order(localStep) > Self.order(serverStep) else { return serverStep }
        return localStep
    }

    var stepIndex: Int { Self.order(step) }
    var stepCount: Int { OnboardingStep.runnerSetup.count }
    /// Before a race exists the runner can still go back and pick crew instead.
    var canGoBack: Bool { roomId == nil && !busy }

    static func order(_ step: OnboardingStep) -> Int {
        OnboardingStep.runnerSetup.firstIndex(of: step) ?? 0
    }

    /// The runner flow's open setup step; signed out it is always the account.
    static func firstOpenSetupStep(_ state: OnboardingState, signedIn: Bool) -> OnboardingStep {
        guard signedIn else { return .account }
        if state.flow == .runner, state.phase == .setup, let step = state.step { return step }
        let open = state.steps.first { OnboardingStep.runnerSetup.contains($0.step) && !$0.isComplete }
        return open?.step ?? (state.roomId == nil ? .account : .projectionTeaser)
    }

    // MARK: Account

    var trimmedName: String { displayName.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canSaveName: Bool { !trimmedName.isEmpty && !busy }

    func signUp() { onSignUp() }
    func signIn() { onSignIn() }

    /// Auth0 is open for Create account or Sign in.
    var authWorking: Bool { !signedIn && (auth?.isWorking ?? false) }
    /// Which of the two buttons started it.
    var authSigningUp: Bool { auth?.signingUp ?? false }

    /// What the step shows under it: the step's own failure, or signed out, how Auth0 ended
    /// (offline keeps the checklist's Offline copy).
    var shownFailure: OnboardingSetupFailure? {
        if step == .account, !signedIn, !authWorking { return auth?.failure }
        return failure
    }

    func saveName() {
        guard canSaveName else { return }
        let name = trimmedName
        draft.displayName = name
        persist()
        onDisplayName(name)
        failure = nil
        localStep = .course
        onMark(.account, .done, nil)
    }

    // MARK: Course

    var courseSummary: String? {
        coursePreview.map { OnboardingCopy.courseSummary(lengthMeters: $0.lengthMeters, checkpoints: $0.checkpoints.count) }
    }

    func pickedCourse(_ result: Result<[URL], any Error>) async {
        let picked: (name: String, xml: String)
        do {
            guard let url = try result.get().first else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            picked = (url.lastPathComponent, String(decoding: data, as: UTF8.self))
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError { return }
            failure = .failed
            return
        }
        await useCourse(fileName: picked.name, xml: picked.xml)
    }

    /// A course file was picked: keep it, create the race if there is none, and preview it.
    func useCourse(fileName: String, xml: String) async {
        let trimmed = xml.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            failure = .failed
            return
        }
        courseFileName = fileName.isEmpty ? "course.gpx" : fileName
        courseXml = trimmed
        coursePreview = nil
        draft.courseFileName = courseFileName
        draft.coursePreview = nil
        draft.courseConfirmed = false
        draftStore?.saveCourse(trimmed)
        persist()
        await previewCourse()
    }

    /// Retries the preview of the file already picked (after offline or an error).
    func previewCourse() async {
        guard let fileName = courseFileName, let xml = courseXml, !busy else { return }
        let ticket = generation
        busy = true
        failure = nil
        defer { busy = false }
        do {
            let room = try await ensureRoom(fileName: fileName)
            guard ticket == generation else { return }
            let preview: CoursePreview
            do {
                preview = try await RaceDayAPI.previewGpx(graph: client.graph, roomId: room, fileName: fileName, gpxXml: xml)
            } catch let http as ClientHTTPError where (http.status == 404 || http.status == 403) && draft.roomId == room {
                // The race this phone created is gone. Make a new one and preview there.
                roomId = nil
                draft.roomId = nil
                let fresh = try await ensureRoom(fileName: fileName)
                preview = try await RaceDayAPI.previewGpx(graph: client.graph, roomId: fresh, fileName: fileName, gpxXml: xml)
            }
            guard ticket == generation else { return }
            coursePreview = preview
            draft.coursePreview = preview
            // Another file picked on the start time step stays on that step after a relaunch.
            draft.courseConfirmed = step == .startTime
            persist()
        } catch {
            guard ticket == generation else { return }
            fail(error, courseSave: true)
        }
    }

    var canContinueCourse: Bool { coursePreview != nil && !busy }

    /// The picked file's preview failed (offline, or a file the server can't read): the step's
    /// main button previews the same file again, so it offers Try again rather than Continue.
    var courseNeedsRetry: Bool { courseFileName != nil && coursePreview == nil && failure != nil && !busy }

    func continueCourse() {
        guard canContinueCourse else { return }
        draft.courseConfirmed = true
        persist()
        failure = nil
        localStep = .startTime
    }

    private func ensureRoom(fileName: String) async throws -> String {
        if let roomId { return roomId }
        guard let userId else { throw ClientHTTPError(status: 401, message: "No session.") }
        let ticket = generation
        let base = (fileName as NSString).deletingPathExtension.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = draft.displayName.isEmpty ? displayName : draft.displayName
        let room = try await RaceDayAPI.createRoom(
            graph: client.graph,
            name: base.isEmpty ? fileName : base,
            athleteId: userId,
            teamId: userId,
            creatorName: name.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        // Signed out (or another account) meanwhile: nothing of this race goes into a draft.
        guard ticket == generation else { throw CancellationError() }
        roomId = room.id
        role = "athlete"
        draft.roomId = room.id
        persist()
        onRaceCreated(room.id)
        return room.id
    }

    // MARK: Start time

    var startInput: RaceStartInput {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let parts = utc.dateComponents([.year, .month, .day, .hour, .minute], from: startWallClock)
        return RaceStartInput(
            year: parts.year ?? 0,
            month: parts.month ?? 0,
            day: parts.day ?? 0,
            hour: parts.hour ?? 0,
            minute: parts.minute ?? 0,
            timeZoneIdentifier: timeZoneIdentifier
        )
    }

    /// The zone the runner picked for the race. The teaser and the history comparison read their
    /// times in it, like the start.
    var raceTimeZone: TimeZone {
        DeviceTimeZone.resolve(timeZoneIdentifier) ?? DeviceTimeZone.current
    }

    /// The race's zone when it isn't this phone's, to label the times shown in it.
    var raceTimeZoneLabel: String? {
        let zone = raceTimeZone
        guard zone.identifier != DeviceTimeZone.current.identifier else { return nil }
        return zone.localizedName(for: .generic, locale: .current) ?? zone.identifier
    }

    /// The daylight saving copy shows only for a skipped local time, never for other problems.
    var showsDaylightSavingGap: Bool { startInput.problem == .daylightSavingGap }
    var canSaveStart: Bool { startInput.raceStartAt != nil && courseXml != nil && courseFileName != nil && roomId != nil && !busy }

    var zoneIdentifiers: [String] {
        let all = TimeZone.knownTimeZoneIdentifiers
        let query = zoneSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return all }
        return all.filter { $0.localizedCaseInsensitiveContains(query.replacingOccurrences(of: " ", with: "_")) }
    }

    func pickZone(_ identifier: String) {
        timeZoneIdentifier = identifier
        showsZonePicker = false
        zoneSearch = ""
    }

    /// Saves the course with the chosen start (`PUT /race-rooms/:roomId/course`).
    func saveStart() async {
        guard canSaveStart, let roomId, let fileName = courseFileName, let xml = courseXml,
              let raceStartAt = startInput.raceStartAt else { return }
        let ticket = generation
        busy = true
        failure = nil
        defer { busy = false }
        do {
            _ = try await RaceDayAPI.importGpx(
                graph: client.graph,
                roomId: roomId,
                fileName: fileName,
                gpxXml: xml,
                raceStartAt: raceStartAt,
                plannedPaceSecondsPerKm: coursePreview?.plannedPaceSecondsPerKm ?? 0
            )
            guard ticket == generation else { return }
            localStep = .history
            await onServerStepSaved()
        } catch {
            guard ticket == generation else { return }
            fail(error, courseSave: true)
        }
    }

    // MARK: History

    /// A past run file was picked: import it, then compare the finish with and without history.
    func pickedHistory(_ result: Result<URL, any Error>) async {
        guard !busy else { return }
        failure = nil
        historyMessage = nil
        busy = true
        let status = await activityImport.picked(result)
        busy = false
        if status == nil, activityImport.offline {
            failure = .offline
            return
        }
        historyMessage = activityImport.message
        guard status != nil else { return }
        historyImported = true
        await compareHistory()
    }

    /// One estimate without history and one with it (attached), for the comparison line.
    func compareHistory() async {
        guard let roomId, !busy else { return }
        let ticket = generation
        busy = true
        failure = nil
        defer { busy = false }
        do {
            let comparison = try await PlanOfRecord.recomputeComparingHistory(graph: client.graph, roomId: roomId, role: role)
            guard ticket == generation else { return }
            historyAttached = true
            historyLine = comparison.line(timeZone: raceTimeZone)
            draft.historyLine = historyLine
            persist()
        } catch {
            guard ticket == generation else { return }
            fail(error, courseSave: false)
        }
    }

    /// No history: a rough estimate, a cold start computed with no past runs at all, even when
    /// some were imported (`historyRefIds: []`).
    func skipHistory() async {
        await finishHistory(.skipped)
    }

    func continueHistory() async {
        await finishHistory(.done)
    }

    private func finishHistory(_ outcome: OnboardingOutcome) async {
        guard let roomId, !busy else { return }
        let ticket = generation
        // Continue keeps the estimate the comparison attached; Skip always attaches the cold start.
        if !historyAttached || outcome == .skipped {
            busy = true
            failure = nil
            do {
                if outcome == .skipped {
                    _ = try await PlanOfRecord.recomputeWithoutHistory(graph: client.graph, roomId: roomId, role: role)
                } else {
                    _ = try await PlanOfRecord.recompute(graph: client.graph, roomId: roomId, role: role, trigger: .auto, hasPlanOfRecord: false)
                }
            } catch {
                busy = false
                guard ticket == generation else { return }
                fail(error, courseSave: false)
                return
            }
            busy = false
        }
        guard ticket == generation else { return }
        localStep = .projectionTeaser
        onMark(.history, outcome, roomId)
    }

    // MARK: Projection teaser

    /// Finish ETA plus the timeline, every aid row the race locks shown locked.
    func loadTeaser() async {
        guard let roomId, !busy else { return }
        let ticket = generation
        busy = true
        failure = nil
        defer { busy = false }
        do {
            // The raw body, so the replay after setup keeps the course line `RoomEnvelope` drops.
            let body = try await RaceDayAPI.loadRoomData(graph: client.graph, roomId: roomId)
            let room = try JSONDecoder().decode(RoomEnvelope.self, from: body).room
            let sheet = try await RaceDayAPI.loadScheduleResult(graph: client.graph, roomId: roomId, cacheDirectory: nil).sheet
            let projection = try? await RaceDayAPI.projectionCore(graph: client.graph, roomId: roomId)
            guard ticket == generation else { return }
            onRoomLoaded(roomId, body)
            let teaser = OnboardingTeaser(sheet: sheet, projection: projection, estimate: room.pacingEstimate)
            var lockedSheet = sheet
            lockedSheet.locked = TeaserLockedCheckpoints(checkpointIds: teaser.lockedCheckpointIds)
            let checkpoints = (room.course?.checkpoints ?? []).map {
                AidStationCheckpoint(
                    id: $0.id,
                    title: $0.title,
                    latitude: $0.latitude,
                    longitude: $0.longitude,
                    distanceMetersFromStart: $0.distanceMetersFromStart,
                    plannedStopSeconds: $0.plannedStopSeconds
                )
            }
            self.teaser = teaser
            teaserCheckpoints = checkpoints
            // No ping before the race: nothing is passed. Progress only ever comes from the runner's pings.
            teaserRows = RaceDayReadouts.timeline(
                sheet: lockedSheet,
                checkpoints: checkpoints,
                progressMeters: RunnerProgress.none.progressMeters(checkpoints: checkpoints),
                showLocked: true
            )
            if coursePreview == nil, let course = room.course {
                // A relaunch without the draft: draw the saved checkpoints.
                coursePreview = CoursePreview(courseFileName: room.courseFileName ?? "", checkpoints: course.checkpoints, plannedPaceSecondsPerKm: nil, route: [])
            }
            teaserAttempted = true
        } catch {
            guard ticket == generation else { return }
            teaserAttempted = true
            fail(error, courseSave: false)
        }
    }

    var canContinueTeaser: Bool { teaser?.finishAt != nil && failure == nil && !busy }

    /// The teaser load failed, or answered without a finish: the step offers Try again (and
    /// tries by itself when the network returns or the app comes back to the foreground).
    var teaserNeedsRetry: Bool {
        step == .projectionTeaser && teaserAttempted && !busy && (failure != nil || teaser?.finishAt == nil)
    }

    func retryTeaserIfNeeded() async {
        guard teaserNeedsRetry else { return }
        await loadTeaser()
    }

    /// While the teaser step is on screen: each time the network comes back, a failed teaser
    /// loads again. Ends with the calling task.
    func retryTeaserWhenOnline() async {
        var wasOnline = true
        for await path in NWPathMonitor() {
            let online = path.status == .satisfied
            if online, !wasOnline {
                await retryTeaserIfNeeded()
            }
            wasOnline = online
        }
    }

    func continueTeaser() {
        guard canContinueTeaser, let roomId else { return }
        draftStore?.clear()
        draft = RunnerSetupDraft(displayName: draft.displayName)
        onMark(.projectionTeaser, .done, roomId)
    }

    // MARK: Shared

    /// Sign-out. The user's directory is already wiped, so nothing here may write to it again:
    /// `reset()` lets go of the draft store before it touches a single field.
    func clear() {
        reset()
        signedIn = false
        userId = nil
    }

    private func fail(_ error: any Error, courseSave: Bool) {
        let kind = OnboardingSetupFailure.classify(error, courseSave: courseSave)
        failure = kind
        client.graph.logger.log("onboarding setup \(step.rawValue) failed: \(kind.rawValue)")
        if kind.opensPaywall {
            onPaywall()
        }
    }

    private func adoptRoom(_ next: String) {
        generation += 1
        roomId = next
        teaser = nil
        teaserRows = []
        teaserCheckpoints = []
        teaserAttempted = false
        historyAttached = false
        historyImported = false
        localStep = nil
        failure = nil
        busy = false
        if let saved = draft.roomId, saved != next {
            // A draft from another race: keep the name, forget the course.
            draft.resetRace(next)
            courseFileName = nil
            courseXml = nil
            coursePreview = nil
            historyLine = nil
            draftStore?.saveCourse(nil)
            persist()
        } else if draft.roomId == nil {
            draft.roomId = next
            persist()
        }
    }

    private func applyDraft(fallbackName: String?) {
        let fallback = fallbackName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        displayName = draft.displayName.isEmpty ? fallback : draft.displayName
        courseFileName = draft.courseFileName
        coursePreview = draft.coursePreview
        historyLine = draft.historyLine
        if let saved = draft.startWallClock { startWallClock = saved }
        if let zone = draft.timeZoneIdentifier, DeviceTimeZone.resolve(zone) != nil { timeZoneIdentifier = zone }
    }

    private func saveStartDraft() {
        guard draftStore != nil else { return }
        draft.startWallClock = startWallClock
        draft.timeZoneIdentifier = timeZoneIdentifier
        persist()
    }

    private func persist() {
        draftStore?.save(draft)
    }

    /// Forgets the user and everything typed or picked. The draft store goes first: the start
    /// fields' observers save the draft, and after sign-out (or for another account) that write
    /// would put this user's draft back on disk.
    private func reset() {
        draftStore = nil
        draft = RunnerSetupDraft()
        generation += 1
        roomId = nil
        role = "athlete"
        serverStep = .account
        localStep = nil
        displayName = ""
        courseFileName = nil
        courseXml = nil
        coursePreview = nil
        startWallClock = Self.defaultWallClock()
        timeZoneIdentifier = DeviceTimeZone.current.identifier
        showsZonePicker = false
        zoneSearch = ""
        importingCourse = false
        importingHistory = false
        historyLine = nil
        historyMessage = nil
        historyAttached = false
        historyImported = false
        teaser = nil
        teaserRows = []
        teaserCheckpoints = []
        teaserAttempted = false
        busy = false
        failure = nil
    }

    /// Tomorrow at 06:00 as wall-clock fields (in UTC, like `startWallClock`).
    static func defaultWallClock(now: Date = Date()) -> Date {
        var local = Calendar(identifier: .gregorian)
        local.timeZone = DeviceTimeZone.current
        let tomorrow = local.date(byAdding: .day, value: 1, to: now) ?? now
        let parts = local.dateComponents([.year, .month, .day], from: tomorrow)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        var fields = DateComponents()
        fields.year = parts.year
        fields.month = parts.month
        fields.day = parts.day
        fields.hour = 6
        fields.minute = 0
        return utc.date(from: fields) ?? now
    }
}
