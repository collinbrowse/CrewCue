import Foundation

/// Moving back and forth between the runner's setup steps (clients/behavior/onboarding-runner-setup.md).
///
/// The frontier is the furthest step setup has reached. Back opens the step before the one on
/// screen and keeps everything entered. A step opened with Back is reviewed: its Continue opens the
/// next step, one at a time, until it meets the frontier again. The frontier itself never moves
/// back, so going back over a saved step never undoes it.
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
}
