import XCTest

/// The race-day replay and its paywall (clients/behavior/onboarding-race-preview.md) on the dev
/// route, which plays the real replay on the client-core fixture race with no API.
///
/// The replay runs on a 25 s wall clock, and an accessibility snapshot can take seconds on CI, so
/// a check that waits for a beat while the replay plays can miss it. Every beat check opens the
/// route paused at a moment in that beat (`?at=<seconds>&paused=1`) and reads it there. Beats:
/// following 0-10 s (Map), falling behind 10-14 s (Pace), dead zone 14-20 s (Map, 18 min ago from
/// 18 s to 19.5 s), crew chat 20-25 s (Chat, the message from 22 s). Only one test plays through,
/// and it checks nothing that depends on when a beat lands. A paused moment doesn't change, so a
/// check on it gets the full wait too. A predicate wait first reads about 1 s in, and a read that
/// ends after the timeout is a miss even when the caption matches: a 2 s wait gets one snapshot,
/// and one takes over 1 s on CI (up to 4 s seen). So every wait for something to appear or go is
/// 10 s; only the checks that expect nothing to change (paused, the replay holds) wait 4 s.
@MainActor
final class OnboardingRacePreviewTests: XCTestCase {
    private let route = "crewcue://dev/onboarding-race-preview"

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

    /// Plays from the start, or with `at`, opens paused at that moment (Back from the paywall then
    /// stays paused, at the start).
    @discardableResult
    private func launch(app: XCUIApplication = XCUIApplication(), at seconds: Double? = nil) -> XCUIApplication {
        app.launchArguments = ["--signed-out", "--deeplink", seconds.map { "\(route)?at=\($0)&paused=1" } ?? route]
        app.launch()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 10), "replay missing")
        return app
    }

    /// The live finish on Pace: "Finish ETA 12:50 PM" from the progress header, read as one element.
    private func paceFinish(_ app: XCUIApplication) throws -> String {
        let eta = element(app, "crewcue.live-eta")
        XCTAssertTrue(eta.waitForExistence(timeout: 10), "Pace shows the live finish ETA")
        return try XCTUnwrap(eta.label.range(of: "Finish ETA").map { String(eta.label[$0.lowerBound...]) }, eta.label)
    }

    /// Waits until the caption reads `text`.
    private func waitForCaption(_ app: XCUIApplication, _ text: String, timeout: TimeInterval) -> Bool {
        let caption = element(app, "crewcue.onboarding-race-preview.caption")
        let reads = NSPredicate(format: "label CONTAINS %@", text)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: reads, object: caption)], timeout: timeout) == .completed
    }

    func testSkipOpensThePaywallBackReplaysAndNotNowLeaves() {
        let app = launch(at: 0)
        XCTAssertTrue(waitForCaption(app, following, timeout: 10), "first beat caption missing")
        XCTAssertTrue(element(app, "crewcue.map").exists, "the replay plays in the real Map view")
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview.play-pause").exists)
        let skip = element(app, "crewcue.onboarding-race-preview.skip")
        XCTAssertTrue(skip.isHittable, "Skip is always available")

        skip.tap()
        let paywall = element(app, "crewcue.onboarding-paywall")
        XCTAssertTrue(paywall.waitForExistence(timeout: 10), "Skip opens the paywall")
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
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 10), "Back returns to the replay")
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))

        element(app, "crewcue.onboarding-race-preview.skip").tap()
        XCTAssertTrue(paywall.waitForExistence(timeout: 10))
        let notNow = element(app, "crewcue.onboarding-paywall.not-now")
        XCTAssertEqual(notNow.label, "Not now")
        notNow.tap()
        // The dev route leaves for the app's own launch: signed out, onboarding's entry.
        let gone = NSPredicate(format: "exists == false")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: gone, object: paywall)], timeout: 10), .completed)
        XCTAssertFalse(element(app, "crewcue.onboarding-race-preview").exists)
        let entries = ["crewcue.onboarding-chooser", "crewcue.onboarding-runner-setup", "crewcue.join-crew"]
        XCTAssertTrue(entries.contains { element(app, $0).waitForExistence(timeout: 10) }, "Not now leaves the replay flow")
    }

    /// Beat 1 on Pace from the strip, then beat 2, where the compact width shows Pace itself: the
    /// finish the runner's pings give moves later.
    func testTheFinishOnPaceMovesLaterFromBeatOneToBeatTwo() throws {
        let app = launch(at: 5)
        XCTAssertTrue(waitForCaption(app, following, timeout: 10), "first beat caption missing")
        XCTAssertTrue(waitForCaption(app, "1 of 4", timeout: 10), "the paused beat reads 1 of 4")
        XCTAssertTrue(element(app, "crewcue.runner-track").waitForExistence(timeout: 10), "the runner's path chip on the Map")
        element(app, "crewcue.onboarding-race-preview.panel").buttons["Pace"].tap()
        let firstFinish = try paceFinish(app)

        launch(app: app, at: 12.5)
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 10), "second beat caption missing")
        XCTAssertTrue(waitForCaption(app, "2 of 4", timeout: 10), "the paused beat reads 2 of 4")
        XCTAssertTrue(element(app, "crewcue.schedule-sheet").waitForExistence(timeout: 10), "Pace shows the finish moving")
        let slipped = try paceFinish(app)
        XCTAssertNotEqual(slipped, firstFinish, "the finish moves later at beat 2")
        XCTAssertFalse(app.buttons["Race tools"].exists, "the replay never writes")
    }

    /// Unpaid: every aid row on Pace is locked and shows no ETA; only the finish has a time.
    func testPaceLocksEveryAidRow() throws {
        let app = launch(at: 12.5)
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 10), "second beat caption missing")
        let schedule = element(app, "crewcue.schedule-sheet")
        XCTAssertTrue(schedule.waitForExistence(timeout: 10), "Pace lists the checkpoints")
        for title in ["Aid 1", "Aid 2", "Aid 3"] {
            let row = schedule.otherElements.matching(NSPredicate(format: "label ==[c] %@", title)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10), "Pace lists \(title)")
            XCTAssertEqual(row.value as? String, lockedAid, "\(title) is locked")
            XCTAssertTrue(row.staticTexts.matching(NSPredicate(format: "label == %@", lockedAid)).firstMatch.exists, "\(title) reads Locked")
            let times = row.staticTexts.matching(NSPredicate(format: "label CONTAINS 'ETA' OR label CONTAINS[c] 'arrival' OR label MATCHES %@", ".*[0-9]:[0-9][0-9].*"))
            XCTAssertEqual(times.count, 0, "\(title) shows no aid ETA in the replay")
        }
    }

    /// Beat 3, on the Map: the runner's ping chip reads 18 min ago (the caption says so too, so
    /// the check reads the chip, not the caption).
    func testTheDeadZoneReadsEighteenMinutesAgoOnTheMap() {
        let app = launch(at: 18.5)
        XCTAssertTrue(waitForCaption(app, deadZone, timeout: 10), "third beat caption missing")
        XCTAssertTrue(waitForCaption(app, "3 of 4", timeout: 10), "the paused beat reads 3 of 4")
        XCTAssertTrue(element(app, "crewcue.map").exists, "the dead zone is on the Map")
        let chip = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Runner signal is stale", "18 min ago"))
            .firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "Last update reads 18 min ago in the dead zone")
    }

    /// Beat 4: the crew message, in Chat, with no way to send.
    func testTheCrewMessageShowsInChatWithNoWayToSend() {
        let app = launch(at: 23)
        XCTAssertTrue(waitForCaption(app, crewChat, timeout: 10), "fourth beat caption missing")
        XCTAssertTrue(waitForCaption(app, "4 of 4", timeout: 10), "the paused beat reads 4 of 4")
        XCTAssertTrue(element(app, "crewcue.chat").waitForExistence(timeout: 10), "Chat shows at its beat")
        let message = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", crewMessage)).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 10), "the crew message arrives")
        XCTAssertFalse(element(app, "crewcue.chat-attach").exists, "no photo picker in the replay")
        XCTAssertFalse(element(app, "crewcue.chat-message").exists, "no message field in the replay")
        XCTAssertFalse(element(app, "crewcue.chat-send").exists, "no send button in the replay")
    }

    /// Played through, unpaused: the replay ends on the paywall. Nothing here waits for a beat.
    func testTheReplayPlaysThroughToThePaywall() {
        let app = launch()
        let control = element(app, "crewcue.onboarding-race-preview.play-pause")
        XCTAssertTrue(control.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Race tools"].exists, "the replay never writes")
        // 25 s of replay, with room for a slow device.
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 90), "the replay ends on the paywall")
        XCTAssertFalse(element(app, "crewcue.onboarding-race-preview").exists)
    }

    /// The Map's aid sheet keeps the next aid station through layout changes (the strip to Pace and
    /// back, a rotation): a pager laid out again never selects Start (`AidPager`).
    func testTheAidSheetKeepsTheNextAidStationThroughLayoutChanges() {
        addTeardownBlock { XCUIDevice.shared.orientation = .portrait }
        let app = launch(at: 5)
        XCTAssertTrue(waitForCaption(app, following, timeout: 10), "first beat caption missing")
        XCTAssertEqual(aidPageOnScreen(app), "Next aid station", "the aid sheet follows the next aid station")

        let strip = element(app, "crewcue.onboarding-race-preview.panel")
        strip.buttons["Pace"].tap()
        XCTAssertTrue(element(app, "crewcue.live-eta").waitForExistence(timeout: 10))
        strip.buttons["Map"].tap()
        XCTAssertEqual(aidPageOnScreen(app), "Next aid station", "Pace and back keeps the next aid station")

        // A rotation lays the pager out again at another width. (Landscape's short map pane can
        // leave the sheet out of view, so it is read back in portrait.)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))
        XCUIDevice.shared.orientation = .portrait
        XCTAssertEqual(aidPageOnScreen(app), "Next aid station", "a rotation keeps the next aid station")

        // The person's own swipe still picks another aid station, and it stays.
        // On a slow machine the pager can still be settling from the rotation when the swipe lands;
        // the app rightly treats that scroll as layout, not a pick. So swipe once the pager sits
        // still, at a person's pace, and swipe again if one was lost, as a person would.
        var picked: String?
        for _ in 0..<3 {
            guard let page = settledAidPage(app) else { break }
            page.swipeRight(velocity: .slow)
            picked = aidPageOnScreen(app, timeout: 5) { $0 != nil && $0 != "Next aid station" }
            if let picked, picked != "Next aid station" { break }
        }
        XCTAssertNotNil(picked, "a swipe shows the aid station before")
        XCTAssertNotEqual(picked, "Next aid station", "a swipe picks another aid station")
        // It stays: the sheet doesn't jump back to the next aid station on its own.
        let later = aidPageOnScreen(app, timeout: 3) { $0 != picked }
        XCTAssertEqual(later, picked, "the picked aid station stays")
    }

    /// The aid page in view once it has stopped moving (two reads of its frame 0.3 s apart agree),
    /// or nil when there is none within 10 s.
    private func settledAidPage(_ app: XCUIApplication) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(10)
        var last: CGRect?
        repeat {
            if let page = aidPageElementOnScreen(app) {
                if page.frame == last { return page }
                last = page.frame
            }
            Thread.sleep(forTimeInterval: 0.3)
        } while Date() < deadline
        return aidPageElementOnScreen(app)
    }

    /// The aid page in view. The pages sit side by side; the one in view is the one whose middle is
    /// inside the window.
    private func aidPageElementOnScreen(_ app: XCUIApplication) -> XCUIElement? {
        let window = app.windows.firstMatch.frame
        return app.descendants(matching: .any).matching(identifier: "crewcue.aid-page").allElementsBoundByIndex
            .first { window.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY)) }
    }

    /// The eyebrow of the aid page in view ("Next aid station", "Aid 1"…), once it reads as
    /// `expected` says (the pager settles), or the last one read when it never does.
    private func aidPageOnScreen(
        _ app: XCUIApplication,
        timeout: TimeInterval = 10,
        until expected: (String?) -> Bool = { $0 == "Next aid station" }
    ) -> String? {
        var seen: String?
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            seen = aidPageElementOnScreen(app)?.value as? String
            if expected(seen) { return seen }
        } while Date() < deadline
        return seen
    }

    func testBackFromAPaywallSkippedLateReplaysFromTheFirstBeat() {
        let app = launch(at: 12)
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 10), "second beat caption missing")
        XCTAssertTrue(waitForCaption(app, "2 of 4", timeout: 10), "the paused beat reads 2 of 4")

        element(app, "crewcue.onboarding-race-preview.skip").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 10), "Skip opens the paywall")
        element(app, "crewcue.onboarding-paywall.back").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview").waitForExistence(timeout: 10), "Back returns to the replay")
        // The dev route's paused start stays paused, at the start.
        XCTAssertTrue(waitForCaption(app, "1 of 4", timeout: 10), "Back replays from the first beat")
        XCTAssertTrue(waitForCaption(app, following, timeout: 10), "the paused beat reads the first caption")
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
                XCTAssertTrue(message.waitForExistence(timeout: 10), "\(state): message")
                XCTAssertEqual(message.label, copy)
                XCTAssertFalse(element(app, "crewcue.map").exists, "\(state): nothing to play")
                XCTAssertFalse(element(app, "crewcue.onboarding-race-preview.play-pause").exists, "\(state): nothing to pause")
                element(app, "crewcue.onboarding-race-preview.skip").tap()
                XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 10), "\(state): Skip opens the paywall")
            }
        }
    }

    /// Opens paused 9 s in, a second before beat 2: paused, the first beat stays; Play goes on to
    /// beat 2 from there, and Pause holds whatever moment it stops on.
    func testPauseHoldsTheReplayAndPlayGoesOn() {
        let app = launch(at: 9)
        XCTAssertTrue(waitForCaption(app, following, timeout: 10))
        let control = element(app, "crewcue.onboarding-race-preview.play-pause")
        XCTAssertTrue(control.waitForExistence(timeout: 10))
        XCTAssertEqual(control.label, "Play")
        XCTAssertFalse(waitForCaption(app, fallingBehind, timeout: 4), "paused, the replay holds its moment")
        control.tap()
        XCTAssertEqual(control.label, "Pause")
        XCTAssertTrue(waitForCaption(app, fallingBehind, timeout: 15), "Play carries on from the same moment")
        control.tap()
        XCTAssertEqual(control.label, "Play")
        let caption = element(app, "crewcue.onboarding-race-preview.caption")
        let held = caption.label
        let moved = NSPredicate(format: "label != %@", held)
        XCTAssertEqual(
            XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: moved, object: caption)], timeout: 4), .timedOut,
            "paused again, the caption holds"
        )
    }
}
