import Foundation
import Testing
@testable import CrewCueClientCore

private let enUS = Locale(identifier: "en_US")

/// Newer ICU puts a narrow no-break space before AM/PM; compare with plain spaces.
private func plain(_ text: String?) -> String? {
    text?.replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
}

@Test func historyComparisonShowsBothFinishesInTheViewersZone() {
    let utc = TimeZone(identifier: "UTC")!
    let denver = TimeZone(identifier: "America/Denver")!
    let with = "2026-08-15T09:42:00.000Z"
    let without = "2026-08-15T10:15:00.000Z"
    #expect(plain(OnboardingCopy.historyComparison(
        withHistoryFinishAt: with, withoutHistoryFinishAt: without, timeZone: utc, locale: enUS
    )) == "Finish 9:42 AM instead of 10:15 AM")
    // Same two instants, other zone (MDT is UTC-6).
    #expect(plain(OnboardingCopy.historyComparison(
        withHistoryFinishAt: with, withoutHistoryFinishAt: without, timeZone: denver, locale: enUS
    )) == "Finish 3:42 AM instead of 4:15 AM")
}

@Test func historyComparisonAcrossMidnightUsesEachInstantsOwnClock() {
    let denver = TimeZone(identifier: "America/Denver")!
    let with = "2026-08-16T05:50:00Z"
    let without = "2026-08-16T06:10:00Z"
    #expect(plain(OnboardingCopy.historyComparison(
        withHistoryFinishAt: with, withoutHistoryFinishAt: without, timeZone: denver, locale: enUS
    )) == "Finish 11:50 PM instead of 12:10 AM")
    // In UTC the same pair sits on one side of midnight.
    #expect(plain(OnboardingCopy.historyComparison(
        withHistoryFinishAt: with, withoutHistoryFinishAt: without, timeZone: TimeZone(identifier: "UTC")!, locale: enUS
    )) == "Finish 5:50 AM instead of 6:10 AM")
}

@Test func historyComparisonIsNilForAnUnparseableInstant() {
    #expect(OnboardingCopy.historyComparison(withHistoryFinishAt: "nope", withoutHistoryFinishAt: "2026-08-15T10:15:00Z") == nil)
    #expect(OnboardingCopy.historyComparison(withHistoryFinishAt: "2026-08-15T10:15:00Z", withoutHistoryFinishAt: "nope") == nil)
}

@Test func onboardingCopyHasTheAgreedStrings() {
    #expect(OnboardingCopy.chooserRunner == "I'm running a race")
    #expect(OnboardingCopy.chooserCrew == "I'm crewing for someone")
    #expect(OnboardingCopy.paywallRunnerPlusOneTitle == "You + 1 crew")
    #expect(OnboardingCopy.paywallRunnerPlusOneProduct == "Race Pass")
    #expect(OnboardingCopy.paywallRunnerPlusOnePrice == "$14.99")
    #expect(OnboardingCopy.paywallFullCrewTitle == "Your whole crew")
    #expect(OnboardingCopy.paywallFullCrewProduct == "Race Pass + Full Crew")
    #expect(OnboardingCopy.paywallFullCrewPrice == "$19.99")
    #expect(OnboardingCopy.paywallPitch == "Give your crew this on race day.")
    #expect(OnboardingCopy.unpaidBanner == "Unlock race")
    #expect(OnboardingCopy.courseSaveLimit == "You've changed the course a lot this hour. Try again in a bit.")
    #expect(OnboardingCopy.startTimeDstGap
        == "That time doesn't exist on that date because of daylight saving. Pick another time.")
    #expect(OnboardingCopy.replayCaption(.following) == "Your crew sees this the moment your phone sends a ping.")
    #expect(OnboardingCopy.replayCaption(.deadZone).contains("Last update 18 min ago"))
}

@Test func everyScaffoldedStepHasATitleAndExplanation() {
    let covered: [OnboardingStep] = [.account, .course, .startTime, .history, .projectionTeaser, .preview, .paywall]
    for step in covered {
        #expect(OnboardingCopy.title(for: step)?.isEmpty == false)
        #expect(OnboardingCopy.explanation(for: step)?.isEmpty == false)
    }
    #expect(OnboardingCopy.title(for: .invites) == nil)
}

@Test func onboardingCopyIsPlain() {
    var all: [String] = [
        OnboardingCopy.chooserRunner, OnboardingCopy.chooserCrew, OnboardingCopy.replaySkip,
        OnboardingCopy.paywallRunnerPlusOneTitle, OnboardingCopy.paywallFullCrewTitle, OnboardingCopy.paywallPitch,
        OnboardingCopy.unpaidBanner, OnboardingCopy.courseSaveLimit, OnboardingCopy.startTimeDstGap
    ]
    for step in OnboardingStep.allCases {
        all += [OnboardingCopy.title(for: step), OnboardingCopy.explanation(for: step)].compactMap { $0 }
    }
    for beat in DemoRaceBeat.allCases { all.append(OnboardingCopy.replayCaption(beat)) }
    for id in ["onboarding-runner-setup", "onboarding-race-preview"] {
        for state in [FeatureState.success, .empty, .error, .offline] {
            all.append(CrewCueClientCore.featureScreen(id: id, state: state).body)
        }
    }
    for text in all {
        #expect(!text.contains("!"), "\(text)")
        #expect(!text.unicodeScalars.contains { $0.properties.isEmojiPresentation }, "\(text)")
    }
}

@Test func onboardingFeatureScreensCarryTheirAccessibilityIds() {
    for id in ["onboarding-runner-setup", "onboarding-race-preview"] {
        for state in [FeatureState.success, .empty, .error, .offline] {
            let screen = CrewCueClientCore.featureScreen(id: id, state: state)
            #expect(screen.accessibilityIdentifier == "crewcue.\(id)")
            #expect(!screen.body.isEmpty)
        }
    }
}
