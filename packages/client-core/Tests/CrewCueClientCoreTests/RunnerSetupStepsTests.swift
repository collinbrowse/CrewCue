import Testing
@testable import CrewCueClientCore

// Back and Continue between the runner's setup steps (clients/behavior/onboarding-runner-setup.md).

@Test func backOpensThePreviousSetupStep() {
    #expect(RunnerSetupSteps.previous(.projectionTeaser) == .history)
    #expect(RunnerSetupSteps.previous(.history) == .startTime)
    #expect(RunnerSetupSteps.previous(.startTime) == .course)
    #expect(RunnerSetupSteps.previous(.course) == .account)
    // The first step has no setup step before it: Back leaves for the chooser.
    #expect(RunnerSetupSteps.previous(.account) == nil)
    #expect(RunnerSetupSteps.previous(.paywall) == nil)
}

@Test func backFromTheFirstStepReturnsToTheChooserOnlyBeforeTheRaceExists() {
    #expect(RunnerSetupSteps.canGoBack(from: .account, raceExists: false))
    #expect(!RunnerSetupSteps.canGoBack(from: .account, raceExists: true))
    for step in [OnboardingStep.course, .startTime, .history, .projectionTeaser] {
        #expect(RunnerSetupSteps.canGoBack(from: step, raceExists: true))
        #expect(RunnerSetupSteps.canGoBack(from: step, raceExists: false))
    }
}

@Test func aReviewedStepShowsOnlyWhileItIsBehindTheFrontier() {
    #expect(RunnerSetupSteps.shown(frontier: .history, reviewing: nil) == .history)
    #expect(RunnerSetupSteps.shown(frontier: .history, reviewing: .course) == .course)
    #expect(RunnerSetupSteps.shown(frontier: .history, reviewing: .history) == .history)
    // A frontier that fell back behind the reviewed step (another race) shows the frontier.
    #expect(RunnerSetupSteps.shown(frontier: .course, reviewing: .history) == .course)
}

@Test func continueOnAReviewedStepWalksForwardToTheFrontier() {
    // Back twice from the history step, then Continue, Continue.
    var reviewing: OnboardingStep? = RunnerSetupSteps.previous(.history)
    reviewing = reviewing.flatMap(RunnerSetupSteps.previous)
    #expect(reviewing == .course)
    reviewing = RunnerSetupSteps.reviewing(after: .startTime, frontier: .history)
    #expect(reviewing == .startTime)
    reviewing = RunnerSetupSteps.reviewing(after: .history, frontier: .history)
    #expect(reviewing == nil)
}

@Test func theFrontierNeverMovesBack() {
    #expect(RunnerSetupSteps.frontier(.course, movingTo: .startTime) == .startTime)
    // Saving a reviewed start time moves on to the history step; a frontier on the teaser stays.
    #expect(RunnerSetupSteps.frontier(.projectionTeaser, movingTo: .history) == .projectionTeaser)
    #expect(RunnerSetupSteps.frontier(.history, movingTo: .history) == .history)
}

// MARK: Race name (a race is never named after its course file)

@Test func aNewRaceIsNamedAsTypedElseAsListedElseNotAtAll() {
    #expect(RunnerSetupSteps.newRaceName(typed: "  Canyons 2027 ", listed: "Western States") == "Canyons 2027")
    // Made on another phone, gone and made again: the race list's name, not the file's.
    #expect(RunnerSetupSteps.newRaceName(typed: "", listed: " Western States ") == "Western States")
    #expect(RunnerSetupSteps.newRaceName(typed: "   ", listed: nil) == nil)
    #expect(RunnerSetupSteps.newRaceName(typed: "", listed: "  ") == nil)
}

// MARK: Course

@Test func aCourseFingerprintReadsTheContentNotTheWhitespaceAroundIt() {
    let gpx = "<gpx><trk/></gpx>"
    #expect(RunnerSetupSteps.courseFingerprint(gpx) == RunnerSetupSteps.courseFingerprint("\n  \(gpx)\n"))
    #expect(RunnerSetupSteps.courseFingerprint(gpx) != RunnerSetupSteps.courseFingerprint("<gpx><rte/></gpx>"))
    // SHA-256 of "abc".
    #expect(RunnerSetupSteps.courseFingerprint("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
}

@Test func theSameCoursePickedAgainAfterBackIsNotSavedTwice() {
    // The file this phone holds, picked again: nothing changes.
    #expect(RunnerSetupSteps.coursePick(fingerprint: "a", held: "a", saved: "a") == .unchanged)
    // Back over an unsaved file, then the saved one picked again: it goes back to saved.
    #expect(RunnerSetupSteps.coursePick(fingerprint: "a", held: "b", saved: "a") == .savedCourse)
    #expect(RunnerSetupSteps.coursePick(fingerprint: "c", held: "a", saved: "a") == .newCourse)
    // A phone with no draft knows neither.
    #expect(RunnerSetupSteps.coursePick(fingerprint: "a", held: nil, saved: nil) == .newCourse)
}

@Test func aPhoneWithoutTheFileKeepsTheRacesSavedCourse() {
    #expect(RunnerSetupSteps.courseContinue(holdsPickedFile: true, previewed: true, courseSavedOnRace: false) == .confirm)
    #expect(RunnerSetupSteps.courseContinue(holdsPickedFile: true, previewed: false, courseSavedOnRace: true) == .preview)
    // B1: signed out and back in (no draft), Back to the course step: Continue, not the empty pick.
    #expect(RunnerSetupSteps.courseContinue(holdsPickedFile: false, previewed: false, courseSavedOnRace: true) == .keepSavedCourse)
    #expect(RunnerSetupSteps.courseContinue(holdsPickedFile: false, previewed: false, courseSavedOnRace: false) == .chooseFile)
}

// MARK: Start time

private let saved = "2026-11-21T13:00:00.000Z"
private let moved = "2026-11-21T14:30:00.000Z"

@Test func startsCompareAsInstantsToTheMinute() {
    #expect(RunnerSetupSteps.sameStart(saved, "2026-11-21T13:00:00Z"))
    #expect(RunnerSetupSteps.sameStart(saved, "2026-11-21T13:00:42.500Z"))
    #expect(!RunnerSetupSteps.sameStart(saved, moved))
    #expect(!RunnerSetupSteps.sameStart(saved, nil))
    #expect(!RunnerSetupSteps.sameStart(nil, nil))
    #expect(!RunnerSetupSteps.sameStart("tomorrow", "tomorrow"))
}

private func start(
    reviewing: Bool = true,
    edited: Bool = false,
    courseUnsaved: Bool = false,
    courseSaved: Bool = true,
    holdsFile: Bool = false,
    start: String? = saved,
    savedStart: String? = saved
) -> RunnerSetupSteps.StartTimeContinue {
    RunnerSetupSteps.startTimeContinue(
        reviewing: reviewing,
        editedThisVisit: edited,
        courseUnsaved: courseUnsaved,
        courseSavedOnRace: courseSaved,
        holdsCourseFile: holdsFile,
        start: start,
        savedStart: savedStart
    )
}

@Test func b1APhoneWithoutTheDraftGoesBackAndContinuesWithoutTheFile() {
    // Filled from the race's start, nothing edited: Continue moves on. No file needed, no upload.
    #expect(start() == .moveOn)
    // The race list hasn't given a start yet: nothing edited still moves on (never the default
    // tomorrow 06:00 saved over the race's start).
    #expect(start(start: "2026-11-22T06:00:00.000Z", savedStart: nil) == .moveOn)
    // Edited back to the saved start: nothing to save.
    #expect(start(edited: true) == .moveOn)
}

@Test func b1AStartOnlyChangeIsPatchedAndNeverReuploadsTheCourse() {
    #expect(start(edited: true, start: moved) == .saveStart)
    // Even with the file on this phone: the course is saved already, so only the start goes.
    #expect(start(edited: true, holdsFile: true, start: moved) == .saveStart)
    // A race without a course saves the start with the file, and needs the file for that.
    #expect(start(edited: true, courseSaved: false, holdsFile: true, start: moved) == .saveCourse)
    #expect(start(edited: true, courseSaved: false, holdsFile: false, start: moved) == .needsCourseFile)
    // An impossible time (daylight saving gap) is refused.
    #expect(start(edited: true, start: nil) == .invalidStart)
}

@Test func aFilePickedAfterBackIsSavedWithTheStart() {
    #expect(start(courseUnsaved: true, holdsFile: true) == .saveCourse)
    #expect(start(courseUnsaved: true, holdsFile: true, start: nil) == .invalidStart)
    #expect(start(courseUnsaved: true, holdsFile: false) == .needsCourseFile)
}

@Test func theFrontierStartTimeAlwaysSaves() {
    // First time on the step: the picked course goes with the start.
    #expect(start(reviewing: false, courseUnsaved: true, courseSaved: false, holdsFile: true, savedStart: nil) == .saveCourse)
    // A race that has a course but no start yet (made elsewhere): the start alone.
    #expect(start(reviewing: false, courseSaved: true, savedStart: nil) == .saveStart)
    #expect(start(reviewing: false, courseSaved: false, holdsFile: false, savedStart: nil) == .needsCourseFile)
}

@Test func m1AnEditLeftUnsavedBeforeARelaunchIsSavedByContinue() {
    // Not edited on this visit, but the draft's start differs from the race's: Continue saves it.
    #expect(start(start: moved) == .saveStart)
    #expect(RunnerSetupSteps.startUnsaved(draftHasStart: true, draftStart: moved, savedStart: saved))
    #expect(!RunnerSetupSteps.startUnsaved(draftHasStart: true, draftStart: saved, savedStart: saved))
    // A draft with no start fields, or no known saved start, has nothing unsaved.
    #expect(!RunnerSetupSteps.startUnsaved(draftHasStart: false, draftStart: moved, savedStart: saved))
    #expect(!RunnerSetupSteps.startUnsaved(draftHasStart: true, draftStart: moved, savedStart: nil))
    // An impossible time on screen differs from the saved one.
    #expect(RunnerSetupSteps.startUnsaved(draftHasStart: true, draftStart: nil, savedStart: saved))
}

@Test func b1TheStartTimeStepFillsFromTheRacesStart() {
    func adopt(hasStart: Bool = true, draft: String? = saved, savedStart: String? = saved, race: String? = saved, unsaved: Bool = false) -> RunnerSetupSteps.RaceStartAdoption {
        RunnerSetupSteps.raceStartAdoption(draftHasStart: hasStart, draftStart: draft, savedStart: savedStart, raceStart: race, courseUnsaved: unsaved)
    }
    // No draft (sign-out and back in, a second phone): the fields show the race's start.
    #expect(adopt(hasStart: false, draft: nil, savedStart: nil) == .fill)
    #expect(adopt() == .keep)
    #expect(adopt(race: nil) == .keep)
    #expect(adopt(race: "soon") == .keep)
    // M3: a draft from the build before savedRaceStartAt keeps its fields and learns the saved start.
    #expect(adopt(draft: moved, savedStart: nil) == .takeSaved)
    // The start moved on another phone and this one has no edit: show the race's.
    #expect(adopt(draft: saved, savedStart: saved, race: moved) == .fill)
    // An unsaved edit here, or a file waiting to be saved with the start, keeps the fields.
    #expect(adopt(draft: "2026-11-21T16:00:00.000Z", savedStart: saved, race: moved) == .takeSaved)
    #expect(adopt(draft: saved, savedStart: saved, race: moved, unsaved: true) == .takeSaved)
}

// MARK: History

@Test func b2AReviewedHistoryStepAlwaysOffersContinue() {
    func shows(reviewing: Bool = false, imported: Bool = false, estimate: Bool = false) -> Bool {
        RunnerSetupSteps.historyShowsContinue(reviewing: reviewing, importedThisVisit: imported, raceHasEstimate: estimate)
    }
    #expect(shows(reviewing: true))
    #expect(shows(imported: true))
    // First visit: import a run or skip it.
    #expect(!shows())
}

@Test func aPhoneWithNoSetupProgressOffersContinueOnARaceWithAnEstimate() {
    // A reinstall, another phone, a sign-in on a new device: the history step is the frontier
    // again, but the race kept the estimate the step attached there.
    #expect(RunnerSetupSteps.historyShowsContinue(reviewing: false, importedThisVisit: false, raceHasEstimate: true))
}

private func history(
    reviewing: Bool = true,
    dropped: Bool = false,
    imported: Bool = false,
    attached: Bool = false,
    estimate: Bool = false
) -> RunnerSetupSteps.HistoryContinue {
    RunnerSetupSteps.historyContinue(
        reviewing: reviewing,
        estimateDropped: dropped,
        importedThisVisit: imported,
        attachedThisVisit: attached,
        raceHasEstimate: estimate
    )
}

@Test func b2ContinueOnAReviewedHistoryStepKeepsTheEstimate() {
    // Relaunch, Back to history, Continue: the history-based estimate stays.
    #expect(history() == .moveOn)
    #expect(history(estimate: true) == .moveOn)
    // The comparison attached one on this visit: keep it.
    #expect(history(imported: true, attached: true) == .moveOn)
    #expect(history(reviewing: false, imported: true, attached: true) == .moveOn)
    #expect(history(reviewing: false, imported: true, attached: true, estimate: true) == .moveOn)
    // An import whose comparison failed, or a course save that dropped the estimate: compute one.
    #expect(history(imported: true) == .recompute)
    #expect(history(dropped: true) == .recompute)
    #expect(history(reviewing: false, imported: true) == .recompute)
}

@Test func continueOnAPhoneWithNoSetupProgressKeepsTheRacesEstimate() {
    // The frontier history step of a race that has an estimate: no request, marked done here.
    #expect(history(reviewing: false, estimate: true) == .keepRaceEstimate)
    // A run imported on this visit, or a course save this phone made that dropped it (a stale race
    // list still listing the estimate): compute one, as before.
    #expect(history(reviewing: false, imported: true, estimate: true) == .recompute)
    #expect(history(reviewing: false, dropped: true, estimate: true) == .recompute)
    // No estimate on the race: Continue only shows after an import, which computes one.
    #expect(history(reviewing: false) == .recompute)
}

@Test func historyContinueMarksTheStepUnlessItMovesOnOverAnUnchangedStep() {
    #expect(RunnerSetupSteps.historyContinueMarks(.recompute, attachedThisVisit: false))
    #expect(RunnerSetupSteps.historyContinueMarks(.keepRaceEstimate, attachedThisVisit: false))
    #expect(RunnerSetupSteps.historyContinueMarks(.moveOn, attachedThisVisit: true))
    #expect(!RunnerSetupSteps.historyContinueMarks(.moveOn, attachedThisVisit: false))
}

// MARK: Relaunch

@Test func aRelaunchReopensTheStepThatStillHasToBeSaved() {
    func resume(_ frontier: OnboardingStep, unsaved: Bool = false, previewed: Bool = false, start: Bool = false, dropped: Bool = false) -> OnboardingStep? {
        RunnerSetupSteps.resumeStep(frontier: frontier, courseUnsaved: unsaved, coursePreviewed: previewed, startUnsaved: start, estimateDropped: dropped)
    }
    #expect(resume(.projectionTeaser) == nil)
    // A file picked after Back and never saved.
    #expect(resume(.projectionTeaser, unsaved: true) == .course)
    #expect(resume(.history, unsaved: true, previewed: true) == .startTime)
    // M1: a start edited after Back and never saved.
    #expect(resume(.projectionTeaser, start: true) == .startTime)
    #expect(resume(.history, start: true) == .startTime)
    // B2: the course was saved again after the history step, which dropped its estimate.
    #expect(resume(.projectionTeaser, dropped: true) == .history)
    #expect(resume(.history, dropped: true) == nil)
    // On or before the start time there's nothing behind to reopen.
    #expect(resume(.startTime, unsaved: true, start: true) == nil)
}
