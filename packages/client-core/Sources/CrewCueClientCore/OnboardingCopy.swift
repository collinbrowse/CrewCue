import Foundation

/// User-facing onboarding strings shared by iOS and Android (clients/behavior/onboarding-runner-setup.md,
/// onboarding-race-preview.md). Plain wording only: no hype, no exclamation marks, no emoji.
public enum OnboardingCopy {
    // MARK: Chooser

    public static let chooserRunner = "I'm running a race"
    public static let chooserCrew = "I'm crewing for someone"

    // MARK: Steps

    /// Short heading for a step, or nil for steps this copy file does not cover.
    public static func title(for step: OnboardingStep) -> String? {
        switch step {
        case .account: "Your account"
        case .course: "Your course"
        case .startTime: "Start time"
        case .history: "Training history"
        case .projectionTeaser: "Your finish time"
        case .preview: "How race day looks"
        case .paywall: "Unlock your race"
        default: nil
        }
    }

    /// One or two plain sentences under the step heading, or nil for steps this file does not cover.
    public static func explanation(for step: OnboardingStep) -> String? {
        switch step {
        case .account: "Sign in and pick the name your crew sees."
        case .course: "Add your course file so CrewCue can plan your aid stations."
        case .startTime: "Pick the date and time you start, in the time zone of the race."
        case .history: "Add past runs to tighten your estimate, or skip this and add them later."
        case .projectionTeaser: "This is your estimated finish time. Aid station times unlock with your race."
        case .preview: "A short replay on your course shows what your crew sees on race day."
        case .paywall: "Unlock your race so your crew can follow you."
        default: nil
        }
    }

    // MARK: History comparison

    /// "Finish 9:42 AM instead of 10:15 AM". Both instants are API ISO-8601 strings, shown in the
    /// viewer's zone through `ScheduleFormat.formatScheduleClock`. Nil when either instant does not parse.
    public static func historyComparison(
        withHistoryFinishAt: String,
        withoutHistoryFinishAt: String,
        timeZone: TimeZone = DeviceTimeZone.current,
        locale: Locale = .current
    ) -> String? {
        guard ScheduleFormat.parseISO8601(withHistoryFinishAt) != nil,
              ScheduleFormat.parseISO8601(withoutHistoryFinishAt) != nil else { return nil }
        let with = ScheduleFormat.formatScheduleClock(withHistoryFinishAt, timeZone: timeZone, locale: locale)
        let without = ScheduleFormat.formatScheduleClock(withoutHistoryFinishAt, timeZone: timeZone, locale: locale)
        return "Finish \(with) instead of \(without)"
    }

    // MARK: Replay captions

    /// Caption for each replay beat, in second person.
    public static func replayCaption(_ beat: DemoRaceBeat) -> String {
        switch beat {
        case .following: "Your crew sees this the moment your phone sends a ping."
        case .fallingBehind: "When you slow down, your finish time moves later on every crew phone."
        case .deadZone: "With no signal, your crew sees Last update 18 min ago. Your saved pings arrive together when you are back."
        case .crewChat: "Your crew can message you, and you see it in the race chat."
        }
    }

    public static let replaySkip = "Skip"

    // MARK: Paywall

    public static let paywallRunnerPlusOneTitle = "You + 1 crew"
    public static let paywallRunnerPlusOneProduct = "Race Pass"
    public static let paywallRunnerPlusOnePrice = "$14.99"
    public static let paywallFullCrewTitle = "Your whole crew"
    public static let paywallFullCrewProduct = "Race Pass + Full Crew"
    public static let paywallFullCrewPrice = "$19.99"
    public static let paywallPitch = "Give your crew this on race day."

    // MARK: Unpaid banner

    public static let unpaidBanner = "Unlock race"

    // MARK: Errors

    /// Course save limit reached (HTTP 429).
    public static let courseSaveLimit = "You've changed the course a lot this hour. Try again in a bit."
    /// A time that does not exist on that date in the chosen zone (spring-forward gap).
    public static let startTimeDstGap = "That time doesn't exist on that date because of daylight saving. Pick another time."
    // `course_mismatch` has no copy on purpose: the client recomputes the estimate and shows nothing.
}
