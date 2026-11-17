import Foundation

/// User-facing onboarding strings shared by iOS and Android (clients/behavior/onboarding-runner-setup.md,
/// onboarding-race-preview.md). Plain wording only: no hype, no exclamation marks, no emoji.
public enum OnboardingCopy {
    // MARK: Chooser

    public static let chooserRunner = "I'm running a race"
    public static let chooserCrew = "I'm crewing for someone"
    public static let chooserTitle = "How will you use CrewCue?"
    public static let chooserRunnerDetail = "Set up your course and start time, then share your race with your crew."
    public static let chooserCrewDetail = "Join your runner's race with the link or code they sent you."
    public static let chooserSignIn = "I already have an account"

    // MARK: Setup controls

    public static let createAccount = "Create account"
    public static let signIn = "Sign in"
    public static let displayName = "Display name"
    public static let continueLabel = "Continue"
    public static let chooseCourseFile = "Choose course file"
    public static let chooseAnotherCourseFile = "Choose another file"
    public static let startLabel = "Start"
    public static let timeZoneLabel = "Time zone"
    public static let timeZoneSearch = "Search time zones"
    public static let importPastRun = "Import a past run"
    public static let skipHistory = "Skip for a rough estimate"
    public static let finishLabel = "Estimated finish"
    public static let coursePreviewLabel = "Course preview"
    public static let elevationProfileLabel = "Elevation profile"
    public static let loading = "Loading"
    public static let back = "Back"
    /// Leaves the paywall for the tab bar; the race stays unpaid behind an Unlock race banner.
    public static let paywallNotNow = "Not now"
    /// A locked aid station row on an unpaid race, and what it means.
    public static let lockedAidRow = "Locked"
    public static let lockedAidExplanation = "Aid station times stay locked until you unlock the race."

    /// "31.1 mi · 6 checkpoints" for the course preview.
    public static func courseSummary(lengthMeters: Double, checkpoints: Int) -> String {
        let miles = lengthMeters.isFinite && lengthMeters > 0 ? PortableFormat.oneDecimal(lengthMeters / 1609.344) : "0.0"
        return "\(miles) mi · \(checkpoints) \(checkpoints == 1 ? "checkpoint" : "checkpoints")"
    }

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
        case .course: "Add your course file so CrewCue can estimate your finish."
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
    /// viewer's zone through `ScheduleFormat.formatScheduleClock`. Nil when either instant does not parse or both print as the same clock.
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
        // Same printed clock: history changed nothing the runner can see, so the caller hides the line.
        guard with != without else { return nil }
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
    // The paywall shows the store-localized price; these are the fallbacks `BillingProduct` already owns.
    public static let paywallRunnerPlusOneProduct = BillingProduct.racePass.title
    public static let paywallRunnerPlusOnePrice = BillingProduct.racePass.fallbackPrice
    public static let paywallFullCrewTitle = "Your whole crew"
    public static let paywallFullCrewProduct = BillingProduct.racePassFullCrew.title
    public static let paywallFullCrewPrice = BillingProduct.racePassFullCrew.fallbackPrice
    public static let paywallPitch = "Give your crew this on race day."

    // MARK: Unpaid banner

    public static let unpaidBanner = "Unlock race"

    // MARK: Errors

    /// Course save limit reached (HTTP 429).
    public static let courseSaveLimit = "You've changed the course a lot this hour. Try again in a bit."
    /// A time that does not exist on that date in the chosen zone (spring-forward gap).
    public static let startTimeDstGap = "That time doesn't exist on that date because of daylight saving. Pick another time."
    // `course_mismatch` has no copy on purpose: the client recomputes the estimate and shows nothing.

    // MARK: Runtime (Android)

    /// Every static string plus step titles, explanations and beat captions, for runtime op `onboardingCopy`.
    static var runtimeCopy: [String: Any] {
        var titles: [String: String] = [:]
        var explanations: [String: String] = [:]
        for step in OnboardingStep.allCases {
            if let title = title(for: step) { titles[step.rawValue] = title }
            if let text = explanation(for: step) { explanations[step.rawValue] = text }
        }
        var captions: [String: String] = [:]
        for beat in DemoRaceBeat.allCases { captions[beat.rawValue] = replayCaption(beat) }
        return [
            "chooserRunner": chooserRunner, "chooserCrew": chooserCrew,
            "chooserTitle": chooserTitle, "chooserRunnerDetail": chooserRunnerDetail,
            "chooserCrewDetail": chooserCrewDetail, "chooserSignIn": chooserSignIn,
            "createAccount": createAccount, "signIn": signIn, "displayName": displayName,
            "continueLabel": continueLabel, "chooseCourseFile": chooseCourseFile,
            "chooseAnotherCourseFile": chooseAnotherCourseFile, "startLabel": startLabel,
            "timeZoneLabel": timeZoneLabel, "timeZoneSearch": timeZoneSearch,
            "importPastRun": importPastRun, "skipHistory": skipHistory, "finishLabel": finishLabel,
            "coursePreviewLabel": coursePreviewLabel, "elevationProfileLabel": elevationProfileLabel,
            "loading": loading, "back": back, "paywallNotNow": paywallNotNow, "lockedAidRow": lockedAidRow, "lockedAidExplanation": lockedAidExplanation,
            "replaySkip": replaySkip, "paywallPitch": paywallPitch, "unpaidBanner": unpaidBanner,
            "paywallRunnerPlusOneTitle": paywallRunnerPlusOneTitle,
            "paywallRunnerPlusOneProduct": paywallRunnerPlusOneProduct,
            "paywallRunnerPlusOnePrice": paywallRunnerPlusOnePrice,
            "paywallFullCrewTitle": paywallFullCrewTitle,
            "paywallFullCrewProduct": paywallFullCrewProduct,
            "paywallFullCrewPrice": paywallFullCrewPrice,
            "courseSaveLimit": courseSaveLimit, "startTimeDstGap": startTimeDstGap,
            "stepTitles": titles, "stepExplanations": explanations, "beatCaptions": captions
        ]
    }
}
