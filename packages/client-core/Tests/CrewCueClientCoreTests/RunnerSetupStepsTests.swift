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
