import Foundation
import Network
import Observation
import CrewCueClientCore

/// The runner's phase 1 setup (clients/behavior/onboarding-runner-setup.md), one step at a time
/// in `OnboardingStep.runnerSetup` order. Every typed or picked value lives here (and in the
/// draft on disk), so a size change, a display switch or a relaunch keeps the step and its data.
///
/// What a step's Continue saves, and which step a relaunch reopens, are client-core
/// `RunnerSetupSteps`: a phone that never held the draft (signed out and back in, a second phone,
/// a reinstall) moves on with what the race saved instead of uploading the course again.
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
    /// A step behind the frontier the runner went Back to (`RunnerSetupSteps`). Nil on the frontier.
    private var reviewing: OnboardingStep?
    /// The relaunch check (`resumeIfNeeded`) hasn't reopened a step yet, and the runner hasn't
    /// moved between steps since signing in. It runs on the first state that isn't loading and
    /// again on each fresh race list, so a stale cached list can't use it up.
    private var resumeWatching = false
    private var resumeChecked = false
    private var draftStore: RunnerSetupDraftStore?
    private var draft = RunnerSetupDraft()
    private var generation = 0
    /// The race list says the race has a course.
    private var raceListHasCourse = false
    /// The race list says the race has an estimate: a phone with no setup progress for it keeps
    /// that one on the history step's Continue.
    private var raceListHasEstimate = false
    /// The step the runner changed something on since it opened. Back, Continue and a relaunch
    /// opening a step forget it.
    private var editedStep: OnboardingStep?
    /// Fields set by code (the draft, the race's start), not edits.
    private var fillingFields = false

    // MARK: Step state

    var displayName = ""
    /// The race's name, typed on the course step until the race exists; kept in the draft as it
    /// is typed. The race is created with it, and there's no rename after that.
    var raceName = "" {
        didSet { if raceName != oldValue { saveRaceNameDraft() } }
    }
    /// The race list's name for this setup's race (never another race's), shown when this
    /// phone's draft didn't name it.
    private var listedRaceName: String?
    private(set) var courseFileName: String?
    private(set) var courseXml: String?
    private(set) var coursePreview: CoursePreview? {
        // Another preview (a new file, a relaunch) waits for its own map again.
        didSet { if coursePreview != oldValue { courseMapReady = false } }
    }
    /// A file picked while a course is already there (this phone's, or the race's), kept aside
    /// until its preview comes back: one the server can't read leaves that course in place, with
    /// Try again and Cancel.
    private(set) var pendingCourse: PendingCourse?
    /// A picked file is being read and previewed (`POST .../course/gpx-preview`).
    private(set) var previewingCourse = false
    /// A picked file is being read, from the pick until its map is ready: the loader says
    /// "Reading your course…" only then, not while a preview restored after a relaunch draws.
    private(set) var readingCourse = false
    /// The preview's map drew its first full frame, or the wait for it ran out. Until then the
    /// preview shows the loader, so no blank tiles or empty profile show first.
    private(set) var courseMapReady = false
    /// The start's wall-clock fields, edited in UTC so every local time (a daylight saving gap
    /// in the chosen zone included) can be picked and then checked by `RaceStartInput`.
    var startWallClock: Date = RunnerSetupModel.defaultWallClock() {
        didSet { if startWallClock != oldValue { startEdited() } }
    }
    var timeZoneIdentifier: String = DeviceTimeZone.current.identifier {
        didSet { if timeZoneIdentifier != oldValue { startEdited() } }
    }
    var showsZonePicker = false
    var zoneSearch = ""
    var importingCourse = false
    var importingHistory = false
    private(set) var historyLine: String?
    private(set) var historyMessage: String?
    /// A past run was imported on this visit to the history step.
    private(set) var historyImported = false
    /// The comparison attached an estimate on this visit to the history step (after an import).
    private var historyAttached = false
    private(set) var teaser: OnboardingTeaser?
    private(set) var teaserRows: [CheckpointTimelineRow] = []
    private(set) var teaserCheckpoints: [AidStationCheckpoint] = []
    /// A teaser load finished (with or without a finish), so a missing finish means "try again".
    private var teaserAttempted = false
    private(set) var busy = false
    private(set) var failure: OnboardingSetupFailure?

    struct PendingCourse: Equatable {
        var fileName: String
        var xml: String
        var fingerprint: String
        /// The course the race already saved from this phone, picked again.
        var saved: Bool
    }

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
    /// setup; the dev route passes whatever state there is. `races` is the race list the state was
    /// read with and `raceNames` the roster's names by race id: only the entries for setup's own
    /// race are read. `freshRaces`: the race list just answered (not the cached one).
    func follow(
        state: OnboardingState,
        signedIn: Bool,
        userId: String?,
        displayName: String?,
        races: [OnboardingRace] = [],
        raceNames: [String: String] = [:],
        freshRaces: Bool = false
    ) {
        let userChanged = userId != self.userId || signedIn != self.signedIn
        if userChanged {
            reset()
            self.signedIn = signedIn
            self.userId = userId
            draftStore = signedIn ? userId.flatMap(RunnerSetupDraftStore.forUser) : nil
            draft = draftStore?.load() ?? RunnerSetupDraft()
            courseXml = draftStore?.loadCourse()
            applyDraft(fallbackName: displayName)
            resumeWatching = signedIn
        }
        let stateRoom = state.flow == .runner ? state.roomId : nil
        if let stateRoom, stateRoom != roomId {
            adoptRoom(stateRoom)
        } else if roomId == nil, let saved = draft.roomId, signedIn {
            // Created here, but the race list hasn't listed it yet.
            roomId = saved
        }
        if let roomId {
            followRace(races.first { $0.roomId == roomId }, listedName: raceNames[roomId])
        }
        serverStep = Self.firstOpenSetupStep(state, signedIn: signedIn)
        if let localStep, Self.order(localStep) <= Self.order(serverStep) {
            self.localStep = nil
        }
        if serverStep == .startTime || serverStep == .course, draft.courseConfirmed, draft.roomId == roomId, coursePreview != nil {
            localStep = .startTime
        }
        if resumeWatching, state.flow != .loading, freshRaces || !resumeChecked {
            resumeChecked = true
            if resumeIfNeeded() { resumeWatching = false }
        }
    }

    /// The race list's entries for setup's race: its name, whether it has a course and an
    /// estimate, its start.
    private func followRace(_ race: OnboardingRace?, listedName: String?) {
        let listed = listedName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !listed.isEmpty { listedRaceName = listed }
        guard let race else { return }
        role = race.role
        raceListHasCourse = race.hasCourse
        raceListHasEstimate = race.hasEstimate
        followRaceStart(race.raceStartAt)
    }

    /// The race's saved start: the fields show it on a phone that never picked one, and the
    /// draft remembers it as saved (`RunnerSetupSteps.raceStartAdoption`).
    private func followRaceStart(_ raceStart: String?) {
        guard draftStore != nil, draft.roomId == roomId else { return }
        let draftHasStart = draft.startWallClock != nil
        switch RunnerSetupSteps.raceStartAdoption(
            draftHasStart: draftHasStart,
            draftStart: draftHasStart ? startInput.raceStartAt : nil,
            savedStart: draft.savedRaceStartAt,
            raceStart: raceStart,
            courseUnsaved: draft.courseUnsaved == true
        ) {
        case .keep:
            return
        case .takeSaved:
            draft.savedRaceStartAt = raceStart
        case .fill:
            if let raceStart { fillStart(raceStart) }
            draft.savedRaceStartAt = raceStart
        }
        persist()
    }

    /// The furthest step setup has reached: the server's open step, or a save ahead of it.
    private var frontierStep: OnboardingStep {
        guard let localStep, Self.order(localStep) > Self.order(serverStep) else { return serverStep }
        return localStep
    }

    /// The step on screen: the frontier, or a step behind it the runner went Back to.
    var step: OnboardingStep {
        RunnerSetupSteps.shown(frontier: frontierStep, reviewing: reviewing)
    }

    /// The step on screen is behind the frontier: opened with Back, or by a relaunch.
    var isReviewing: Bool { step != frontierStep }
    /// The runner changed something on the step on screen since it opened.
    var editedThisVisit: Bool { editedStep == step }

    var stepIndex: Int { Self.order(step) }
    var stepCount: Int { OnboardingStep.runnerSetup.count }
    /// Back shows on every step after the first, and on the first only before a race exists
    /// (it returns to the chooser, where the runner can pick crew instead).
    var showsBack: Bool { RunnerSetupSteps.canGoBack(from: step, raceExists: roomId != nil) }
    var canGoBack: Bool { showsBack && !busy }

    static func order(_ step: OnboardingStep) -> Int {
        RunnerSetupSteps.index(step)
    }

    /// Back: the step before this one, with everything entered kept; from the first step, the
    /// chooser. A picked file that couldn't be read is dropped (the course before it stays).
    func goBack() {
        guard canGoBack else { return }
        failure = nil
        pendingCourse = nil
        let previous = RunnerSetupSteps.previous(step)
        leaveStep()
        if let previous {
            reviewing = previous
        } else {
            onBack()
        }
    }

    /// A step's Continue moved on to `next`: the frontier moves forward (never back), and a step
    /// the runner went back to opens the next one until it reaches the frontier again.
    private func moveOn(to next: OnboardingStep) {
        leaveStep()
        let frontier = RunnerSetupSteps.frontier(frontierStep, movingTo: next)
        if frontier != frontierStep { localStep = frontier }
        if reviewing != nil {
            reviewing = RunnerSetupSteps.reviewing(after: next, frontier: frontier)
        }
    }

    /// What "this visit" means ends with the step: edits, an import, the reading caption.
    private func leaveStep() {
        editedStep = nil
        historyImported = false
        historyAttached = false
        historyMessage = nil
        readingCourse = false
        resumeWatching = false
    }

    /// A relaunch past a step that still has something to save opens that step again: a file
    /// picked after Back and never saved, a start edited and never saved, or a history step whose
    /// estimate a course save dropped. True when it opened one.
    private func resumeIfNeeded() -> Bool {
        guard let roomId, draft.roomId == roomId else { return false }
        let draftHasStart = draft.startWallClock != nil
        let open = RunnerSetupSteps.resumeStep(
            frontier: frontierStep,
            courseUnsaved: draft.courseUnsaved == true && courseFileName != nil,
            coursePreviewed: draft.courseConfirmed && draft.coursePreview != nil,
            startUnsaved: RunnerSetupSteps.startUnsaved(
                draftHasStart: draftHasStart,
                draftStart: startInput.raceStartAt,
                savedStart: draft.savedRaceStartAt
            ),
            estimateDropped: draft.historyRedo == true
        )
        guard let open else { return false }
        leaveStep()
        reviewing = open
        return true
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
        moveOn(to: .course)
        onMark(.account, .done, nil)
    }

    // MARK: Course

    var trimmedRaceName: String { raceName.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// The race exists: its name is read-only, because the API has no rename.
    var raceNameLocked: Bool { roomId != nil }
    /// The name shown once the race exists: as typed on this phone, else the race list's.
    var shownRaceName: String? {
        let typed = trimmedRaceName
        return typed.isEmpty ? listedRaceName : typed
    }
    /// The course file creates the race, so the race needs its name first.
    var canChooseCourse: Bool { !busy && (roomId != nil || !trimmedRaceName.isEmpty) }

    /// The file named on the course step: the one being read, else the one this phone holds.
    var shownCourseFileName: String? { pendingCourse?.fileName ?? courseFileName }

    /// The race already has a course: the list says so, or this phone saved it.
    var courseSavedOnRace: Bool {
        guard let roomId, draft.roomId == roomId else { return raceListHasCourse }
        let savedHere = draft.savedCourseFingerprint != nil || (draft.courseUnsaved == false && draft.savedRaceStartAt != nil)
        return raceListHasCourse || savedHere
    }

    /// The saved course's file name, when this phone knows it without holding the file (the
    /// teaser read it from the room).
    var savedCourseFileName: String? {
        let name = coursePreview?.courseFileName.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? nil : name
    }

    /// The preview's map is ready (or the wait for it ended): the preview replaces its loader.
    func noteCourseMapReady() {
        if !courseMapReady { courseMapReady = true }
        readingCourse = false
    }

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
            // The phone couldn't open the file: say what to do, not "Couldn't save this step."
            failure = .courseUploadFailed
            return
        }
        await useCourse(fileName: picked.name, xml: picked.xml)
    }

    /// A course file was picked: create the race if there is none, and preview it. The same file
    /// picked again changes nothing; the course the race saved, picked again, isn't saved twice.
    func useCourse(fileName: String, xml: String) async {
        guard !busy else { return }
        let trimmed = xml.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            // Nothing to read: whatever course was there stays.
            failure = .courseUnreadable
            return
        }
        let fingerprint = await Task.detached { RunnerSetupSteps.courseFingerprint(trimmed) }.value
        failure = nil
        editedStep = step
        let pick = RunnerSetupSteps.coursePick(fingerprint: fingerprint, held: draft.courseFingerprint, saved: draft.savedCourseFingerprint)
        if pick == .unchanged, courseXml != nil, draft.coursePreview != nil {
            pendingCourse = nil
            return
        }
        let picked = PendingCourse(
            fileName: fileName.isEmpty ? "course.gpx" : fileName,
            xml: trimmed,
            fingerprint: fingerprint,
            saved: pick == .savedCourse
        )
        if courseFileName != nil || courseSavedOnRace {
            await previewPicked(picked)
        } else {
            // The first file: kept on this phone at once, so offline it waits for the network.
            hold(picked, preview: nil)
            await previewCourse()
        }
    }

    /// Previews the file this phone holds (the first pick, or again after offline, an error or a
    /// relaunch).
    func previewCourse() async {
        guard let fileName = courseFileName, let xml = courseXml, !busy else { return }
        let ticket = generation
        guard let preview = await readCourse(fileName: fileName, xml: xml), ticket == generation else {
            // A file with no route can never preview: it isn't kept as the race's file, so the
            // step shows the error and Choose another file, not that file's name as if it took.
            if ticket == generation, failure == .courseUnreadable, coursePreview == nil {
                forgetHeldCourse()
            }
            return
        }
        coursePreview = preview
        draft.coursePreview = preview
        // Another file picked on the start time step stays on that step after a relaunch.
        draft.courseConfirmed = step == .startTime
        persist()
    }

    /// Previews a file picked while a course is already there; it replaces that course only once
    /// the server has read it.
    private func previewPicked(_ picked: PendingCourse) async {
        guard !busy else { return }
        let ticket = generation
        pendingCourse = picked
        guard let preview = await readCourse(fileName: picked.fileName, xml: picked.xml), ticket == generation else { return }
        pendingCourse = nil
        hold(picked, preview: preview)
    }

    /// The main button after a failed preview: the same file again.
    func retryCourse() async {
        if let pendingCourse {
            await previewPicked(pendingCourse)
        } else {
            await previewCourse()
        }
    }

    /// Drops the file this phone held for the race (one the server found no route in).
    private func forgetHeldCourse() {
        courseFileName = nil
        courseXml = nil
        draft.courseFileName = nil
        draft.courseFingerprint = nil
        draft.coursePreview = nil
        draft.courseConfirmed = false
        draftStore?.saveCourse(nil)
        persist()
    }

    /// The picked file previewed and nothing failed since: the step shows a checkmark with
    /// "Course uploaded" and the file's name.
    var courseUploaded: Bool {
        coursePreview != nil && pendingCourse == nil && failure == nil && !previewingCourse && courseFileName != nil
    }

    /// The last pick failed because of the file itself: Choose another file is the main button.
    var courseNeedsAnotherFile: Bool { failure?.needsAnotherFile == true && !busy }

    /// Cancel after a picked file couldn't be read: the course from before stays.
    func cancelPendingCourse() {
        guard !busy else { return }
        pendingCourse = nil
        failure = nil
        readingCourse = false
    }

    /// Keeps `picked` as this phone's file for the race. A new course is saved with the start; the
    /// one the race already saved isn't.
    private func hold(_ picked: PendingCourse, preview: CoursePreview?) {
        courseFileName = picked.fileName
        courseXml = picked.xml
        coursePreview = preview
        draft.courseFileName = picked.fileName
        draft.coursePreview = preview
        draft.courseFingerprint = picked.fingerprint
        draft.courseConfirmed = preview != nil && step == .startTime
        draft.courseUnsaved = !picked.saved
        draftStore?.saveCourse(picked.xml)
        persist()
    }

    /// Creates the race if there is none and previews the file there. Nil after a failure (shown
    /// under the step) or a sign-out meanwhile.
    private func readCourse(fileName: String, xml: String) async -> CoursePreview? {
        let ticket = generation
        busy = true
        previewingCourse = true
        readingCourse = true
        failure = nil
        defer {
            busy = false
            previewingCourse = false
        }
        do {
            let room = try await ensureRoom()
            guard ticket == generation else { return nil }
            do {
                return try await RaceDayAPI.previewGpx(graph: client.graph, roomId: room, fileName: fileName, gpxXml: xml)
            } catch let http as ClientHTTPError where (http.status == 404 || http.status == 403) && draft.roomId == room {
                // The race is gone (or no longer the runner's). Make a new one with the same name.
                guard ticket == generation else { return nil }
                forgetGoneRace()
                let fresh = try await ensureRoom()
                guard ticket == generation else { return nil }
                return try await RaceDayAPI.previewGpx(graph: client.graph, roomId: fresh, fileName: fileName, gpxXml: xml)
            }
        } catch {
            guard ticket == generation else { return nil }
            readingCourse = false
            fail(error, courseSave: true)
            return nil
        }
    }

    /// What the course step's main button does (`RunnerSetupSteps.courseContinue`).
    var courseContinue: RunnerSetupSteps.CourseContinue {
        RunnerSetupSteps.courseContinue(
            holdsPickedFile: courseFileName != nil && courseXml != nil,
            previewed: draft.coursePreview != nil,
            courseSavedOnRace: courseSavedOnRace
        )
    }

    var canContinueCourse: Bool { pendingCourse == nil && courseContinue != .chooseFile && canChooseCourse }

    /// The preview failed (offline, a file the server can't read, no race name): the step's main
    /// button reads the same file again, so it offers Try again rather than Continue.
    var courseNeedsRetry: Bool {
        guard failure != nil, !busy, !courseNeedsAnotherFile else { return false }
        return pendingCourse != nil || (courseFileName != nil && draft.coursePreview == nil)
    }

    func continueCourse() async {
        switch courseContinue {
        case .confirm:
            draft.courseConfirmed = true
            persist()
            failure = nil
            moveOn(to: .startTime)
        case .preview:
            await previewCourse()
        case .keepSavedCourse:
            // The race's course stays; nothing is uploaded again.
            failure = nil
            moveOn(to: .startTime)
        case .chooseFile:
            importingCourse = true
        }
    }

    /// Creates the race with the name typed on the course step, else the race list's name for the
    /// race this setup had. With neither, it fails and the name field is open: a race is never
    /// named after its course file.
    private func ensureRoom() async throws -> String {
        if let roomId { return roomId }
        guard let userId else { throw ClientHTTPError(status: 401, message: "No session.") }
        guard let title = RunnerSetupSteps.newRaceName(typed: raceName, listed: listedRaceName) else {
            throw RaceNameMissing()
        }
        let ticket = generation
        let name = draft.displayName.isEmpty ? displayName : draft.displayName
        let room = try await RaceDayAPI.createRoom(
            graph: client.graph,
            name: title,
            athleteId: userId,
            teamId: userId,
            creatorName: name.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        // Signed out (or another account) meanwhile: nothing of this race goes into a draft.
        guard ticket == generation else { throw CancellationError() }
        roomId = room.id
        role = "athlete"
        draft.roomId = room.id
        draft.raceName = title
        raceName = title
        persist()
        onRaceCreated(room.id)
        return room.id
    }

    private struct RaceNameMissing: Error {}

    /// The race this setup had is gone: a new one gets its name (typed, else the list's), and
    /// nothing the old race saved counts as saved.
    private func forgetGoneRace() {
        let name = shownRaceName ?? ""
        roomId = nil
        draft.roomId = nil
        draft.savedRaceStartAt = nil
        draft.savedCourseFingerprint = nil
        draft.courseUnsaved = true
        draft.historyRedo = nil
        raceListHasCourse = false
        raceListHasEstimate = false
        // The name field is open again, holding the name the new race gets.
        raceName = name
        persist()
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

    /// What the start time step's Continue does (`RunnerSetupSteps.startTimeContinue`).
    var startContinue: RunnerSetupSteps.StartTimeContinue {
        RunnerSetupSteps.startTimeContinue(
            reviewing: isReviewing,
            editedThisVisit: editedThisVisit,
            courseUnsaved: draft.courseUnsaved == true && courseFileName != nil,
            courseSavedOnRace: courseSavedOnRace,
            holdsCourseFile: courseXml != nil && courseFileName != nil,
            start: startInput.raceStartAt,
            savedStart: draft.savedRaceStartAt
        )
    }

    var canContinueStart: Bool {
        guard roomId != nil, !busy else { return false }
        switch startContinue {
        case .moveOn, .saveStart, .saveCourse: return true
        case .needsCourseFile, .invalidStart: return false
        }
    }

    /// The race needs its course saved and this phone lost the file: pick it again.
    var startNeedsCourseFile: Bool { startContinue == .needsCourseFile }

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

    /// Continue on the start time: moves on when nothing changed, saves a start-only change with
    /// `PATCH /race-start`, and the course with the start (`PUT /course`) when the course isn't
    /// saved yet.
    func continueStart() async {
        guard let roomId, !busy else { return }
        switch startContinue {
        case .moveOn:
            // Left as the race saved it: no save (it counts toward the course save limit), and the
            // history step's estimate still holds.
            failure = nil
            moveOn(to: .history)
        case .saveStart:
            await saveStartOnly(roomId: roomId)
        case .saveCourse:
            await saveCourseWithStart(roomId: roomId)
        case .needsCourseFile, .invalidStart:
            return
        }
    }

    /// `PATCH /race-rooms/:roomId/race-start`: the attached estimate moves with the start.
    private func saveStartOnly(roomId: String) async {
        guard let raceStartAt = startInput.raceStartAt else { return }
        let ticket = generation
        busy = true
        failure = nil
        defer { busy = false }
        do {
            _ = try await RaceDayAPI.updateRaceStart(graph: client.graph, roomId: roomId, raceStartAt: raceStartAt)
            guard ticket == generation else { return }
            draft.savedRaceStartAt = raceStartAt
            // The estimate moved with the start; the comparison's two finishes were for the old one.
            historyLine = nil
            draft.historyLine = nil
            persist()
            moveOn(to: .history)
            await onServerStepSaved()
        } catch {
            guard ticket == generation else { return }
            fail(error, courseSave: true)
        }
    }

    /// `PUT /race-rooms/:roomId/course` with the chosen start. It drops the attached estimate, so
    /// the history step runs again (after a relaunch too).
    private func saveCourseWithStart(roomId: String) async {
        guard let fileName = courseFileName, let xml = courseXml, let raceStartAt = startInput.raceStartAt else { return }
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
                plannedPaceSecondsPerKm: draft.coursePreview?.plannedPaceSecondsPerKm ?? 0
            )
            guard ticket == generation else { return }
            let fingerprint: String
            if let held = draft.courseFingerprint {
                fingerprint = held
            } else {
                fingerprint = await Task.detached { RunnerSetupSteps.courseFingerprint(xml) }.value
            }
            guard ticket == generation else { return }
            draft.courseUnsaved = false
            draft.courseFingerprint = fingerprint
            draft.savedCourseFingerprint = fingerprint
            draft.savedRaceStartAt = raceStartAt
            draft.historyRedo = true
            raceListHasCourse = true
            // The save dropped the race's estimate.
            raceListHasEstimate = false
            // An estimate the history step attached was for the course or start before.
            historyAttached = false
            historyLine = nil
            draft.historyLine = nil
            persist()
            moveOn(to: .history)
            await onServerStepSaved()
        } catch {
            guard ticket == generation else { return }
            fail(error, courseSave: true)
        }
    }

    // MARK: History

    /// Continue shows after an import on this visit, always on a history step already passed, and
    /// on a race that already has an estimate (this phone has no setup progress for it).
    var historyShowsContinue: Bool {
        RunnerSetupSteps.historyShowsContinue(
            reviewing: isReviewing,
            importedThisVisit: historyImported,
            raceHasEstimate: raceListHasEstimate
        )
    }

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
        // Continue keeps the estimate the race has (attached on this visit, a reviewed step's, or
        // one attached on another phone) unless a course save dropped it; Skip always attaches the
        // cold start.
        let decision = RunnerSetupSteps.historyContinue(
            reviewing: isReviewing,
            estimateDropped: draft.historyRedo == true,
            importedThisVisit: historyImported,
            attachedThisVisit: historyAttached,
            raceHasEstimate: raceListHasEstimate
        )
        let recomputes = outcome == .skipped || decision == .recompute
        if recomputes {
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
        // A new estimate, one attached on this visit, or the race's kept on a phone that never
        // ended the step: the step is marked with how it ended. Moving on over an unchanged,
        // reviewed step keeps how it was marked before.
        let marks = outcome == .skipped || RunnerSetupSteps.historyContinueMarks(decision, attachedThisVisit: historyAttached)
        draft.historyRedo = nil
        persist()
        moveOn(to: .projectionTeaser)
        if marks { onMark(.history, outcome, roomId) }
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
                // A relaunch without the draft: the saved checkpoints and the saved course line,
                // whose vertices carry the elevation the profile draws from.
                coursePreview = CoursePreview(courseFileName: room.courseFileName ?? "", checkpoints: course.checkpoints, plannedPaceSecondsPerKm: nil, route: CourseRouteLine.points(roomData: body))
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
        let kind: OnboardingSetupFailure = error is RaceNameMissing
            ? .raceNameMissing
            : OnboardingSetupFailure.classify(error, courseSave: courseSave)
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
        reviewing = nil
        editedStep = nil
        pendingCourse = nil
        failure = nil
        busy = false
        previewingCourse = false
        readingCourse = false
        raceListHasCourse = false
        raceListHasEstimate = false
        listedRaceName = nil
        if let saved = draft.roomId, saved != next {
            // A draft from another race: keep the runner's name, forget the race's name and course.
            draft.resetRace(next)
            raceName = ""
            courseFileName = nil
            courseXml = nil
            coursePreview = nil
            historyLine = nil
            draftStore?.saveCourse(nil)
            persist()
        } else if draft.roomId == nil {
            // Made elsewhere (or before this phone saved it): the race list has its name.
            draft.roomId = next
            draft.raceName = nil
            raceName = ""
            persist()
        }
    }

    private func applyDraft(fallbackName: String?) {
        fillingFields = true
        defer { fillingFields = false }
        // A session saved before email names were dropped can still carry one.
        let fallback = SuggestedDisplayName.from(name: fallbackName, email: nil) ?? ""
        displayName = draft.displayName.isEmpty ? fallback : draft.displayName
        raceName = draft.raceName ?? ""
        courseFileName = draft.courseFileName
        coursePreview = draft.coursePreview
        historyLine = draft.historyLine
        if let saved = draft.startWallClock { startWallClock = saved }
        if let zone = draft.timeZoneIdentifier, DeviceTimeZone.resolve(zone) != nil { timeZoneIdentifier = zone }
    }

    /// The fields show `raceStartAt` in the draft's zone (else this phone's).
    private func fillStart(_ raceStartAt: String) {
        let zone = draft.timeZoneIdentifier.flatMap { DeviceTimeZone.resolve($0) == nil ? nil : $0 } ?? timeZoneIdentifier
        guard let input = RaceStartInput(raceStartAt: raceStartAt, timeZoneIdentifier: zone) else { return }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        var fields = DateComponents()
        fields.year = input.year
        fields.month = input.month
        fields.day = input.day
        fields.hour = input.hour
        fields.minute = input.minute
        guard let wallClock = utc.date(from: fields) else { return }
        fillingFields = true
        defer { fillingFields = false }
        startWallClock = wallClock
        timeZoneIdentifier = zone
        draft.startWallClock = wallClock
        draft.timeZoneIdentifier = zone
    }

    /// The start or its zone changed: kept in the draft, and an edit on this visit unless code
    /// filled it.
    private func startEdited() {
        if !fillingFields { editedStep = step }
        guard draftStore != nil else { return }
        draft.startWallClock = startWallClock
        draft.timeZoneIdentifier = timeZoneIdentifier
        persist()
    }

    /// The race's name as it is typed, until the race exists (then it can't change).
    private func saveRaceNameDraft() {
        guard draftStore != nil, roomId == nil else { return }
        let value: String? = raceName.isEmpty ? nil : raceName
        guard draft.raceName != value else { return }
        draft.raceName = value
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
        fillingFields = true
        defer { fillingFields = false }
        roomId = nil
        role = "athlete"
        serverStep = .account
        localStep = nil
        reviewing = nil
        resumeWatching = false
        resumeChecked = false
        raceListHasCourse = false
        raceListHasEstimate = false
        editedStep = nil
        displayName = ""
        raceName = ""
        listedRaceName = nil
        courseFileName = nil
        courseXml = nil
        coursePreview = nil
        pendingCourse = nil
        previewingCourse = false
        readingCourse = false
        courseMapReady = false
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
