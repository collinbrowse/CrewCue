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
    // `OnboardingCopy.lockedAidExplanation`: what a locked aid row says to VoiceOver.
    private let lockedAid = "Aid station times stay locked until you unlock the race."

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

    /// Polls as fast as the accessibility snapshot allows: some readouts hold for about a second.
    private func poll(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
        } while Date() < deadline
        return false
    }

    private func anyElement(_ app: XCUIApplication, labelContains text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
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

    func testTheReplayPlaysEachBeatInItsViewThenOpensThePaywall() throws {
        let app = launch()
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))
        XCTAssertTrue(element(app, "crewcue.runner-track").waitForExistence(timeout: 5), "the runner's path chip on the Map")

        // Beat 1, on Pace from the strip: the finish the runner's pings give so far.
        element(app, "crewcue.onboarding-race-preview.panel").buttons["Pace"].tap()
        let eta = element(app, "crewcue.live-eta")
        XCTAssertTrue(eta.waitForExistence(timeout: 5), "Pace shows the live finish ETA at beat 1")
        // The progress header reads as one element: "…, Finish ETA 12:50 PM".
        let firstFinish = try XCTUnwrap(eta.label.range(of: "Finish ETA").map { String(eta.label[$0.lowerBound...]) }, eta.label)

        // Unpaid: every aid row on Pace is locked and shows no ETA; only the finish has a time.
        let schedule = element(app, "crewcue.schedule-sheet")
        XCTAssertTrue(schedule.waitForExistence(timeout: 5), "Pace lists the checkpoints")
        for title in ["Aid 1", "Aid 2", "Aid 3"] {
            let row = schedule.otherElements.matching(NSPredicate(format: "label ==[c] %@", title)).firstMatch
            XCTAssertTrue(row.exists, "Pace lists \(title)")
            XCTAssertEqual(row.value as? String, lockedAid, "\(title) is locked")
            XCTAssertTrue(row.staticTexts.matching(NSPredicate(format: "label == %@", lockedAid)).firstMatch.exists, "\(title) reads Locked")
            let times = row.staticTexts.matching(NSPredicate(format: "label CONTAINS 'ETA' OR label CONTAINS[c] 'arrival' OR label MATCHES %@", ".*[0-9]:[0-9][0-9].*"))
            XCTAssertEqual(times.count, 0, "\(title) shows no aid ETA in the replay")
        }

        // Beat 2 at 10 s: the finish time slips, on Pace.
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 15), "second beat caption missing")
        XCTAssertTrue(element(app, "crewcue.schedule-sheet").waitForExistence(timeout: 5), "Pace shows the finish moving")
        XCTAssertTrue(eta.waitForExistence(timeout: 5), "Pace shows the live finish ETA")
        let slipped = NSPredicate(format: "NOT (label CONTAINS %@)", firstFinish)
        XCTAssertEqual(
            XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: slipped, object: eta)], timeout: 4), .completed,
            "the finish moves later at beat 2 (was \(firstFinish))"
        )
        XCTAssertFalse(app.buttons["Race tools"].exists, "the replay never writes")
        // Beat 3 at 14 s: the dead zone, back on the Map, until Last update reads 18 min ago.
        XCTAssertTrue(waitForCaption(app, deadZone, timeout: 10), "third beat caption missing")
        XCTAssertTrue(
            poll(timeout: 7) { anyElement(app, labelContains: "18 min ago").exists },
            "Last update reaches 18 min ago in the dead zone"
        )

        // Beat 4 at 20 s: the crew message, in Chat, with no way to send.
        XCTAssertTrue(waitForCaption(app, crewChat, timeout: 10), "fourth beat caption missing")
        XCTAssertTrue(element(app, "crewcue.chat").waitForExistence(timeout: 5), "Chat shows at its beat")
        let message = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", crewMessage)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 6), "the crew message arrives")
        XCTAssertFalse(element(app, "crewcue.chat-attach").exists, "no photo picker in the replay")
        XCTAssertFalse(element(app, "crewcue.chat-message").exists, "no message field in the replay")
        XCTAssertFalse(element(app, "crewcue.chat-send").exists, "no send button in the replay")

        // Played to the end (25 s): the paywall follows.
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 10), "the replay ends on the paywall")
    }

    func testBackFromAPaywallSkippedLateReplaysFromTheFirstBeat() {
        let app = launch()
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 15), "second beat caption missing")
        XCTAssertTrue(waitForCaption(app, "2 of 4", timeout: 2))

        element(app, "crewcue.onboarding-race-preview.skip").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 5), "Skip opens the paywall")
        element(app, "crewcue.onboarding-paywall.back").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 5), "Back returns to the replay")
        XCTAssertTrue(waitForCaption(app, "1 of 4", timeout: 5), "Back replays from the first beat")
        XCTAssertTrue(waitForCaption(app, following, timeout: 2))
        XCTAssertTrue(element(app, "crewcue.map").exists, "the first beat is on the Map")
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
