import Foundation

/// Moving back and forth between the runner's setup steps (clients/behavior/onboarding-runner-setup.md).
///
/// The frontier is the furthest step setup has reached. Back opens the step before the one on
/// screen and keeps everything entered. A step opened with Back is reviewed: its Continue opens the
/// next step, one at a time, until it meets the frontier again. The frontier itself never moves
/// back, so going back over a saved step never undoes it.
///
/// What a reviewed step's Continue saves, and which step a relaunch reopens, are decided here
/// too, so a phone that never held the setup draft (sign-out and back in, a second phone, a
/// reinstall) moves on with what the race already saved instead of saving it again. Pure.
public enum RunnerSetupSteps {
    public static func index(_ step: OnboardingStep) -> Int {
        OnboardingStep.runnerSetup.firstIndex(of: step) ?? 0
    }

    /// The step Back opens from `step`. Nil on the first step, where Back leaves setup.
    public static func previous(_ step: OnboardingStep) -> OnboardingStep? {
        guard let at = OnboardingStep.runnerSetup.firstIndex(of: step), at > 0 else { return nil }
        return OnboardingStep.runnerSetup[at - 1]
    }

    /// Whether Back shows on `step`. On the first step it returns to the chooser, which only
    /// makes sense while the runner has no race yet.
    public static func canGoBack(from step: OnboardingStep, raceExists: Bool) -> Bool {
        previous(step) != nil || !raceExists
    }

    /// The step on screen: the reviewed one while it is behind the frontier, else the frontier.
    public static func shown(frontier: OnboardingStep, reviewing: OnboardingStep?) -> OnboardingStep {
        guard let reviewing, index(reviewing) < index(frontier) else { return frontier }
        return reviewing
    }

    /// The step to review after a Continue on a reviewed step moved on to `next`: `next` while it
    /// is still behind the frontier, nil once it reaches it.
    public static func reviewing(after next: OnboardingStep, frontier: OnboardingStep) -> OnboardingStep? {
        index(next) < index(frontier) ? next : nil
    }

    /// The frontier after a step's Continue moved on to `next`: it only ever moves forward.
    public static func frontier(_ frontier: OnboardingStep, movingTo next: OnboardingStep) -> OnboardingStep {
        index(next) > index(frontier) ? next : frontier
    }

    // MARK: Race name

    /// The name a new race is created with: the one typed on the course step, else the race list's
    /// name for the race this setup had (one made on another phone, or one that is gone). Nil when
    /// there is neither: the race is never named after its course file.
    public static func newRaceName(typed: String, listed: String?) -> String? {
        let name = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        let fallback = listed?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return fallback.isEmpty ? nil : fallback
    }

    // MARK: Course

    /// A course file's content, for telling a file picked again from one that changed. SHA-256
    /// over the trimmed text, as lowercase hex.
    public static func courseFingerprint(_ xml: String) -> String {
        let text = xml.trimmingCharacters(in: .whitespacesAndNewlines)
        return PortableFormat.hex(PortableSHA256.hash(Array(text.utf8)))
    }

    /// What a picked course file is, by its fingerprint.
    public enum CoursePick: Equatable, Sendable {
        /// The file this phone already holds for the race, picked again: nothing changes.
        case unchanged
        /// The course the race already saved (picked again after Back): it isn't saved twice.
        case savedCourse
        /// Another course: it is saved with the start time.
        case newCourse
    }

    /// `held`: the fingerprint of the file this phone holds for the race; `saved`: of the file the
    /// race saved from this phone (`PUT /course`). Either is nil when unknown.
    public static func coursePick(fingerprint: String, held: String?, saved: String?) -> CoursePick {
        if fingerprint == held { return .unchanged }
        if fingerprint == saved { return .savedCourse }
        return .newCourse
    }

    /// What the course step's main button does.
    public enum CourseContinue: Equatable, Sendable {
        /// The picked file is previewed: on to the start time.
        case confirm
        /// The picked file has no preview yet (offline, a relaunch): preview it first.
        case preview
        /// This phone holds no file and the race already saved a course: keep that course and
        /// move on, with nothing uploaded again.
        case keepSavedCourse
        /// Nothing to continue with yet: the runner picks a file.
        case chooseFile
    }

    public static func courseContinue(holdsPickedFile: Bool, previewed: Bool, courseSavedOnRace: Bool) -> CourseContinue {
        if holdsPickedFile { return previewed ? .confirm : .preview }
        return courseSavedOnRace ? .keepSavedCourse : .chooseFile
    }

    // MARK: Start time

    /// Two `raceStartAt` instants name the same start, to the minute (the server and the phone can
    /// write one instant two ways). False when either is missing or doesn't parse.
    public static func sameStart(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b, let first = ScheduleFormat.parseISO8601(a), let second = ScheduleFormat.parseISO8601(b) else {
            return false
        }
        return (first.timeIntervalSince1970 / 60).rounded(.down) == (second.timeIntervalSince1970 / 60).rounded(.down)
    }

    /// The start on screen is an edit the race hasn't saved: the draft has start fields, the race's
    /// saved start is known, and the two differ (an impossible time on screen differs too).
    public static func startUnsaved(draftHasStart: Bool, draftStart: String?, savedStart: String?) -> Bool {
        draftHasStart && savedStart != nil && !sameStart(draftStart, savedStart)
    }

    /// What the start time step's Continue does.
    public enum StartTimeContinue: Equatable, Sendable {
        /// Nothing changed: open the next step, no request.
        case moveOn
        /// Only the start changed, on a race whose course is saved: `PATCH /race-start`, which moves
        /// the attached estimate with the start.
        case saveStart
        /// The course is saved with the start: `PUT /course`, which drops the attached estimate.
        case saveCourse
        /// The course has to be saved and this phone doesn't hold its file: pick it again.
        case needsCourseFile
        /// The start on screen isn't a real time (a daylight saving gap).
        case invalidStart
    }

    /// - Parameters:
    ///   - reviewing: the step is behind the frontier (opened with Back, or by a relaunch).
    ///   - editedThisVisit: the runner changed the start or its zone since the step opened.
    ///   - courseUnsaved: a file was picked that the race hasn't saved; it goes with the start.
    ///   - courseSavedOnRace: the race already has a course.
    ///   - holdsCourseFile: this phone holds the picked file.
    ///   - start: the start on screen (nil when it isn't a real time).
    ///   - savedStart: the start the race saved, when known.
    public static func startTimeContinue(
        reviewing: Bool,
        editedThisVisit: Bool,
        courseUnsaved: Bool,
        courseSavedOnRace: Bool,
        holdsCourseFile: Bool,
        start: String?,
        savedStart: String?
    ) -> StartTimeContinue {
        if courseUnsaved {
            guard start != nil else { return .invalidStart }
            return holdsCourseFile ? .saveCourse : .needsCourseFile
        }
        if reviewing {
            // Left as the race saved it, or as it opened when the saved start isn't known: move on.
            let changed = editedThisVisit || startUnsaved(draftHasStart: true, draftStart: start, savedStart: savedStart)
            guard changed, !sameStart(start, savedStart) else { return .moveOn }
        }
        guard start != nil else { return .invalidStart }
        if courseSavedOnRace { return .saveStart }
        return holdsCourseFile ? .saveCourse : .needsCourseFile
    }

    /// What the race list's start does to the start time fields when it arrives.
    public enum RaceStartAdoption: Equatable, Sendable {
        /// Nothing to change.
        case keep
        /// Remember the race's start as the saved one; the fields stay (an unsaved edit, or a
        /// draft from a build that didn't record the saved start).
        case takeSaved
        /// Fill the fields from the race's start, and remember it as saved.
        case fill
    }

    /// - Parameters:
    ///   - draftHasStart: the setup draft holds start fields (picked on this phone).
    ///   - draftStart: the instant those fields name.
    ///   - savedStart: the start the draft last knew the race saved.
    ///   - raceStart: the race list's start for the race.
    ///   - courseUnsaved: a picked file waits to be saved with the start on screen.
    public static func raceStartAdoption(
        draftHasStart: Bool,
        draftStart: String?,
        savedStart: String?,
        raceStart: String?,
        courseUnsaved: Bool
    ) -> RaceStartAdoption {
        guard let raceStart, ScheduleFormat.parseISO8601(raceStart) != nil else { return .keep }
        // A phone that never picked a start (no draft) shows the race's own.
        if !draftHasStart { return .fill }
        if sameStart(savedStart, raceStart) { return .keep }
        // The start moved elsewhere and this phone has no edit of its own: show the race's.
        if !courseUnsaved, sameStart(draftStart, savedStart) { return .fill }
        return .takeSaved
    }

    // MARK: History

    /// Continue shows on the history step once a past run was imported on this visit, and always
    /// on a reviewed history step (the estimate it attached before still holds).
    public static func historyShowsContinue(reviewing: Bool, importedThisVisit: Bool) -> Bool {
        reviewing || importedThisVisit
    }

    /// What the history step's Continue does.
    public enum HistoryContinue: Equatable, Sendable {
        /// Keep the estimate the race has: the one attached on this visit, or a reviewed step's.
        case moveOn
        /// Compute and attach an estimate (`POST /pacing-estimates`, `PUT …/pacing-estimate`).
        case recompute
    }

    /// - Parameters:
    ///   - estimateDropped: a course save after the history step dropped the estimate it attached.
    ///   - importedThisVisit: a past run was imported since the step opened.
    ///   - attachedThisVisit: the comparison attached an estimate with history since the step opened.
    public static func historyContinue(
        reviewing: Bool,
        estimateDropped: Bool,
        importedThisVisit: Bool,
        attachedThisVisit: Bool
    ) -> HistoryContinue {
        if attachedThisVisit { return .moveOn }
        if reviewing, !estimateDropped, !importedThisVisit { return .moveOn }
        return .recompute
    }

    // MARK: Relaunch

    /// The step a relaunch reopens behind the frontier, or nil to stay on the frontier.
    ///
    /// - Parameters:
    ///   - courseUnsaved: a file picked after Back that the race never saved.
    ///   - coursePreviewed: that file's preview came back and its Continue was pressed.
    ///   - startUnsaved: a start edited after Back and never saved (`startUnsaved(...)`).
    ///   - estimateDropped: a course save after the history step dropped its estimate.
    public static func resumeStep(
        frontier: OnboardingStep,
        courseUnsaved: Bool,
        coursePreviewed: Bool,
        startUnsaved: Bool,
        estimateDropped: Bool
    ) -> OnboardingStep? {
        let past = index(frontier)
        if past > index(.startTime) {
            if courseUnsaved { return coursePreviewed ? .startTime : .course }
            if startUnsaved { return .startTime }
        }
        if past > index(.history), estimateDropped { return .history }
        return nil
    }
}
