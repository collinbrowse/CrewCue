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
    #expect(OnboardingCopy.unpaidBanner == "Unlock race")
    #expect(OnboardingCopy.courseSaveLimit == "You've changed the course a lot this hour. Try again in a bit.")
    #expect(OnboardingCopy.startTimeDstGap
        == "That time doesn't exist on that date because of daylight saving. Pick another time.")
    #expect(OnboardingCopy.replayCaption(.following) == "Your crew sees this the moment your phone sends a ping.")
    #expect(OnboardingCopy.replayCaption(.deadZone).contains("Last update 18 min ago"))
}

@Test func theAccountStepAsksForTheRunnersOwnName() {
    // Not a race or crew name: the race is named on the course step.
    #expect(OnboardingCopy.displayName == "Your name")
    #expect(OnboardingCopy.displayNameHelp == "Your crew sees this in chat.")
    #expect(OnboardingCopy.explanation(for: .account) == "Create an account or sign in, then add your name.")
    #expect(OnboardingCopy.raceNameLabel == "Race name")
    #expect(OnboardingCopy.raceNamePlaceholder == "Western States 2026")
    #expect(OnboardingCopy.raceNameHelp == "Your race and the year, or a fun name for your crew.")
}

@Test func historyTipsNameWhatTheImporterTakes() {
    #expect((1...3).contains(OnboardingCopy.historyTips.count))
    let formats = OnboardingCopy.historyTips[1]
    for ext in ActivityImport.fileExtensions {
        #expect(formats.contains(".\(ext)"), "\(ext)")
    }
    #expect(formats.contains("\(ActivityImport.maxFileBytes / (1024 * 1024)) MB"))
    // Skip is the cold start its button already names; Settings > Past runs imports more later.
    #expect(OnboardingCopy.historyTips[2].contains("rough estimate"))
    #expect(OnboardingCopy.skipHistory.contains("rough estimate"))
    #expect(OnboardingCopy.historyTips[2].contains("Settings"))
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
        OnboardingCopy.replayPause, OnboardingCopy.replayPlay, OnboardingCopy.replayEmpty,
        OnboardingCopy.replayError, OnboardingCopy.replayOffline,
        OnboardingCopy.paywallRunnerPlusOneTitle, OnboardingCopy.paywallFullCrewTitle,
        OnboardingCopy.unpaidBanner, OnboardingCopy.courseSaveLimit, OnboardingCopy.startTimeDstGap,
        OnboardingCopy.replayMapTitle, OnboardingCopy.replayPaceTitle, OnboardingCopy.replayChatTitle,
        OnboardingCopy.paywallBuyLabel(product: .racePass, price: BillingProduct.racePass.fallbackPrice),
        OnboardingCopy.displayNameHelp, OnboardingCopy.raceNameLabel, OnboardingCopy.raceNamePlaceholder,
        OnboardingCopy.raceNameHelp, OnboardingCopy.readingCourse
    ] + OnboardingCopy.historyTips
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

@Test func historyComparisonIsNilWhenBothFinishesPrintTheSame() {
    let utc = TimeZone(identifier: "UTC")!
    #expect(OnboardingCopy.historyComparison(
        withHistoryFinishAt: "2026-08-15T09:42:05Z", withoutHistoryFinishAt: "2026-08-15T09:42:40Z", timeZone: utc, locale: enUS
    ) == nil)
}

@Test func replayCaptionsHaveOneSourceInClientCore() {
    #expect(DemoRaceBeat.allCases.allSatisfy { $0.caption == OnboardingCopy.replayCaption($0) })
}

@Test func replayStateCopyIsTheChecklistsAndTheFeatureScreensToo() {
    // clients/behavior/onboarding-race-preview.md, Empty / Error / Offline.
    #expect(OnboardingCopy.replayEmpty == "Add your course to see the replay on your own route.")
    #expect(OnboardingCopy.replayError == "Couldn't play the replay. Skip to unlock your race.")
    #expect(OnboardingCopy.replayOffline == "Offline. The replay plays from the race saved on this phone.")
    let screen = { (state: FeatureState) in CrewCueClientCore.featureScreen(id: "onboarding-race-preview", state: state).body }
    #expect(screen(.empty) == OnboardingCopy.replayEmpty)
    #expect(screen(.error) == OnboardingCopy.replayError)
    #expect(screen(.offline) == OnboardingCopy.replayOffline)
    #expect(screen(.success) == OnboardingCopy.replayCaption(.following))
    #expect(OnboardingCopy.replayPause == "Pause")
    #expect(OnboardingCopy.replayPlay == "Play")
}

@Test func replayBeatCountNamesTheBeatOutOfFour() {
    #expect(DemoRaceBeat.allCases.map(OnboardingCopy.replayBeatCount) == ["1 of 4", "2 of 4", "3 of 4", "4 of 4"])
}

@Test func onboardingCopyRuntimeOpGivesAndroidTheReplayStrings() async throws {
    let copy = try await runtimeResult(["op": "onboardingCopy"])
    #expect(copy["replayEmpty"] as? String == OnboardingCopy.replayEmpty)
    #expect(copy["replayError"] as? String == OnboardingCopy.replayError)
    #expect(copy["replayOffline"] as? String == OnboardingCopy.replayOffline)
    #expect(copy["replayPause"] as? String == OnboardingCopy.replayPause)
    #expect(copy["replayPlay"] as? String == OnboardingCopy.replayPlay)
}

@Test func paywallBuyLabelNamesTheProductAndItsPrice() {
    #expect(OnboardingCopy.paywallBuyLabel(product: .racePass, price: "$14.99") == "Buy Race Pass, $14.99")
    #expect(OnboardingCopy.paywallBuyLabel(product: .racePassFullCrew, price: "19,99 €") == "Buy Race Pass + Full Crew, 19,99 €")
    // The store's localized price, not the fallback, when it has one.
    #expect(OnboardingCopy.paywallBuyLabel(product: .racePass, price: "£12.99").hasSuffix("£12.99"))
}

@Test func replayStripTitlesAreTheTabBarNames() {
    #expect([OnboardingCopy.replayMapTitle, OnboardingCopy.replayPaceTitle, OnboardingCopy.replayChatTitle] == ["Map", "Pace", "Chat"])
}

@Test func onboardingCopyRuntimeOpGivesAndroidTheBuyLabelAndStripTitles() async throws {
    let copy = try await runtimeResult(["op": "onboardingCopy"])
    let template = try #require(copy["paywallBuyLabelTemplate"] as? String)
    let filled = template
        .replacingOccurrences(of: "{product}", with: BillingProduct.racePassFullCrew.title)
        .replacingOccurrences(of: "{price}", with: "$19.99")
    #expect(filled == OnboardingCopy.paywallBuyLabel(product: .racePassFullCrew, price: "$19.99"))
    #expect(copy["replayMapTitle"] as? String == OnboardingCopy.replayMapTitle)
    #expect(copy["replayPaceTitle"] as? String == OnboardingCopy.replayPaceTitle)
    #expect(copy["replayChatTitle"] as? String == OnboardingCopy.replayChatTitle)
}

@Test func paywallPricesAreTheBillingFallbacks() {
    #expect(OnboardingCopy.paywallRunnerPlusOnePrice == BillingProduct.racePass.fallbackPrice)
    #expect(OnboardingCopy.paywallFullCrewProduct == BillingProduct.racePassFullCrew.title)
}

@Test func paywallOptionDetailsAreTheProductsOwnAndReachAndroid() async throws {
    #expect(OnboardingCopy.paywallRunnerPlusOneDetail == BillingProduct.racePass.detail)
    #expect(OnboardingCopy.paywallFullCrewDetail == BillingProduct.racePassFullCrew.detail)
    let copy = try await runtimeResult(["op": "onboardingCopy"])
    #expect(copy["paywallRunnerPlusOneDetail"] as? String == BillingProduct.racePass.detail)
    #expect(copy["paywallFullCrewDetail"] as? String == BillingProduct.racePassFullCrew.detail)
    #expect(copy["paywallRunnerPlusOnePrice"] as? String == BillingProduct.racePass.fallbackPrice)
    #expect(copy["paywallFullCrewPrice"] as? String == BillingProduct.racePassFullCrew.fallbackPrice)
}

@Test func onboardingCopyRuntimeOpGivesAndroidTheSharedStrings() async throws {
    let copy = try await runtimeResult(["op": "onboardingCopy"])
    #expect(copy["chooserRunner"] as? String == OnboardingCopy.chooserRunner)
    #expect(copy["startTimeDstGap"] as? String == OnboardingCopy.startTimeDstGap)
    #expect((copy["stepTitles"] as? [String: String])?["course"] == OnboardingCopy.title(for: .course))
    #expect((copy["stepExplanations"] as? [String: String])?["paywall"] == OnboardingCopy.explanation(for: .paywall))
    #expect((copy["beatCaptions"] as? [String: String])?["deadZone"] == OnboardingCopy.replayCaption(.deadZone))
    #expect(copy["historyTips"] as? [String] == OnboardingCopy.historyTips)
    #expect(copy["raceNameLabel"] as? String == OnboardingCopy.raceNameLabel)
    #expect(copy["readingCourse"] as? String == OnboardingCopy.readingCourse)
}

@Test func onboardingHistoryComparisonRuntimeOpUsesTheSharedFormatter() async throws {
    let line = try await runtimeResult([
        "op": "onboardingHistoryComparison", "timeZone": "UTC",
        "withHistoryFinishAt": "2026-08-15T09:42:00Z", "withoutHistoryFinishAt": "2026-08-15T10:15:00Z"
    ])
    #expect(line["text"] as? String == OnboardingCopy.historyComparison(
        withHistoryFinishAt: "2026-08-15T09:42:00Z", withoutHistoryFinishAt: "2026-08-15T10:15:00Z",
        timeZone: TimeZone(identifier: "UTC")!))
    let same = try await runtimeResult([
        "op": "onboardingHistoryComparison", "timeZone": "UTC",
        "withHistoryFinishAt": "2026-08-15T09:42:00Z", "withoutHistoryFinishAt": "2026-08-15T09:42:30Z"
    ])
    #expect(same["text"] is NSNull)
}

@Test func raceStartProblemSeparatesDstGapFromBadFields() {
    // 2026-03-08 02:30 does not exist in Denver (clocks jump 02:00 to 03:00).
    let gap = RaceStartInput(year: 2026, month: 3, day: 8, hour: 2, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(gap.problem == .daylightSavingGap)
    #expect(RaceStartInput(year: 2026, month: 3, day: 8, hour: 3, minute: 30, timeZoneIdentifier: "America/Denver").problem == nil)
    #expect(RaceStartInput(year: 2026, month: 2, day: 30, hour: 9, minute: 0, timeZoneIdentifier: "America/Denver").problem == .invalidDate)
    #expect(RaceStartInput(year: 2026, month: 3, day: 8, hour: 25, minute: 0, timeZoneIdentifier: "America/Denver").problem == .invalidDate)
    #expect(RaceStartInput(year: 2026, month: 3, day: 8, hour: 9, minute: 0, timeZoneIdentifier: "Nowhere/Land").problem == .unknownZone)
}

private func runtimeResult(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    let json = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(json["ok"] as? Bool == true, "\(json)")
    return json["result"] as? [String: Any] ?? [:]
}

@Test func theFinishTimeStepHasOneSubtitleTheChecklistsSuccessLine() {
    // One line under "Your finish time" on both platforms, never a near-duplicate pair.
    #expect(OnboardingCopy.explanation(for: .projectionTeaser) == CrewCueClientCore.featureScreen(id: "onboarding-runner-setup", state: .success).body)
}
