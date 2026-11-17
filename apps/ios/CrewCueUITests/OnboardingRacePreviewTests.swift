import XCTest

/// The race-day replay and its paywall (clients/behavior/onboarding-race-preview.md) on the dev
/// route, which plays the real replay on the client-core fixture race with no API.
@MainActor
final class OnboardingRacePreviewTests: XCTestCase {
    private let entry = ["--signed-out", "--deeplink", "crewcue://dev/onboarding-race-preview"]

    // `OnboardingCopy`, client-core: the beat captions the replay shows.
    private let following = "Your crew sees this the moment your phone sends a ping."
    private let fallingBehind = "When you slow down, your finish time moves later on every crew phone."
    private let deadZone = "With no signal, your crew sees Last update 18 min ago."
    private let crewChat = "Your crew can message you, and you see it in the race chat."
    private let crewMessage = "Saw your pings come back in. We'll be ready at the next aid."

    override func setUp() {
        continueAfterFailure = false
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = entry
        app.launch()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 10), "replay missing")
        return app
    }

    /// Waits until the caption reads `text`.
    private func waitForCaption(_ app: XCUIApplication, _ text: String, timeout: TimeInterval) -> Bool {
        let caption = element(app, "crewcue.onboarding-race-preview.caption")
        let reads = NSPredicate(format: "label CONTAINS %@", text)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: reads, object: caption)], timeout: timeout) == .completed
    }

    func testSkipOpensThePaywallBackReplaysAndNotNowLeaves() {
        let app = launch()
        XCTAssertTrue(waitForCaption(app, following, timeout: 10), "first beat caption missing")
        XCTAssertTrue(element(app, "crewcue.map").exists, "the replay plays in the real Map view")
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview.play-pause").exists)
        let skip = element(app, "crewcue.onboarding-race-preview.skip")
        XCTAssertTrue(skip.isHittable, "Skip is always available")

        skip.tap()
        let paywall = element(app, "crewcue.onboarding-paywall")
        XCTAssertTrue(paywall.waitForExistence(timeout: 5), "Skip opens the paywall")
        XCTAssertFalse(element(app, "crewcue.onboarding-race-preview").exists)
        let plusOne = element(app, "crewcue.onboarding-paywall.runner-plus-one")
        let fullCrew = element(app, "crewcue.onboarding-paywall.full-crew")
        XCTAssertTrue(plusOne.exists)
        XCTAssertTrue(fullCrew.exists)
        XCTAssertTrue(app.staticTexts["You + 1 crew"].exists)
        XCTAssertTrue(app.staticTexts["Your whole crew"].exists)
        // No store on the fixture: the BillingProduct fallback prices, and nothing to buy.
        let buyPass = element(app, "crewcue.onboarding-paywall.runner-plus-one.buy")
        let buyFull = element(app, "crewcue.onboarding-paywall.full-crew.buy")
        XCTAssertEqual(buyPass.label, "Buy Race Pass, $14.99")
        XCTAssertEqual(buyFull.label, "Buy Race Pass + Full Crew, $19.99")
        XCTAssertFalse(buyPass.isEnabled)
        XCTAssertFalse(buyFull.isEnabled)

        // Back replays from the start; it never leaves onboarding.
        element(app, "crewcue.onboarding-paywall.back").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 5), "Back returns to the replay")
        XCTAssertTrue(waitForCaption(app, following, timeout: 5))

        element(app, "crewcue.onboarding-race-preview.skip").tap()
        XCTAssertTrue(paywall.waitForExistence(timeout: 5))
        let notNow = element(app, "crewcue.onboarding-paywall.not-now")
        XCTAssertEqual(notNow.label, "Not now")
        notNow.tap()
        // The dev route leaves for the app's own launch: signed out, onboarding's entry.
        let gone = NSPredicate(format: "exists == false")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: gone, object: paywall)], timeout: 5), .completed)
        XCTAssertFalse(element(app, "crewcue.onboarding-race-preview").exists)
        let entries = ["crewcue.onboarding-chooser", "crewcue.onboarding-runner-setup", "crewcue.join-crew"]
        XCTAssertTrue(entries.contains { element(app, $0).waitForExistence(timeout: 5) }, "Not now leaves the replay flow")
    }

    func testTheReplayPlaysEachBeatInItsViewThenOpensThePaywall() {
        let app = launch()
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))
        XCTAssertTrue(element(app, "crewcue.runner-track").waitForExistence(timeout: 5), "the runner's path chip on the Map")

        // Beat 2 at 10 s: the finish time slips, on Pace.
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 15), "second beat caption missing")
        XCTAssertTrue(element(app, "crewcue.schedule-sheet").waitForExistence(timeout: 5), "Pace shows the finish moving")
        XCTAssertTrue(element(app, "crewcue.live-eta").waitForExistence(timeout: 5), "Pace shows the live finish ETA")
        XCTAssertFalse(app.buttons["Race tools"].exists, "the replay never writes")

        // Beat 3 at 14 s: the dead zone, back on the Map.
        XCTAssertTrue(waitForCaption(app, deadZone, timeout: 10), "third beat caption missing")

        // Beat 4 at 20 s: the crew message, in Chat, with no way to send.
        XCTAssertTrue(waitForCaption(app, crewChat, timeout: 10), "fourth beat caption missing")
        XCTAssertTrue(element(app, "crewcue.chat").waitForExistence(timeout: 5), "Chat shows at its beat")
        let message = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", crewMessage)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 6), "the crew message arrives")
        XCTAssertFalse(element(app, "crewcue.chat-attach").exists, "no photo picker in the replay")
        XCTAssertFalse(app.textFields["Message"].exists, "no send control in the replay")

        // Played to the end (25 s): the paywall follows.
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 10), "the replay ends on the paywall")
    }

    /// Empty, Error and Offline (no race saved) on the real screen: the checklist copy, and Skip.
    func testEachStateShowsItsCopyAndSkipStillOpensThePaywall() {
        let states = [
            "empty": "Add your course to see the replay on your own route.",
            "error": "Couldn't play the replay. Skip to unlock your race.",
            "offline": "Offline. The replay plays from the race saved on this phone."
        ]
        let app = XCUIApplication()
        for (state, copy) in states.sorted(by: { $0.key < $1.key }) {
            XCTContext.runActivity(named: state) { _ in
                app.launchArguments = ["--signed-out", "--deeplink", "crewcue://dev/onboarding-race-preview?state=\(state)"]
                app.launch()
                XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 10), "\(state): replay screen")
                let message = element(app, "crewcue.onboarding-race-preview.status")
                XCTAssertTrue(message.waitForExistence(timeout: 5), "\(state): message")
                XCTAssertEqual(message.label, copy)
                XCTAssertFalse(element(app, "crewcue.map").exists, "\(state): nothing to play")
                XCTAssertFalse(element(app, "crewcue.onboarding-race-preview.play-pause").exists, "\(state): nothing to pause")
                element(app, "crewcue.onboarding-race-preview.skip").tap()
                XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 5), "\(state): Skip opens the paywall")
            }
        }
    }

    func testPauseHoldsTheReplayAndPlayGoesOn() {
        let app = launch()
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))
        let control = element(app, "crewcue.onboarding-race-preview.play-pause")
        XCTAssertTrue(control.waitForExistence(timeout: 5))
        XCTAssertEqual(control.label, "Pause")
        control.tap()
        XCTAssertEqual(control.label, "Play")
        // Playing, beat 2 starts 10 s in. Paused, the first beat stays.
        XCTAssertFalse(waitForCaption(app, fallingBehind, timeout: 12), "paused, the replay holds its moment")
        control.tap()
        XCTAssertEqual(control.label, "Pause")
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 15), "Play carries on from the same moment")
    }
}
