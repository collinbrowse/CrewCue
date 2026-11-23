import XCTest

/// Rows below a camera column run to both edges alike, and the controls and rows beside the column
/// stay clear of it (`fullWidthClearOfOcclusions()`). On iPhone Duo's outer display iOS insets the
/// whole trailing edge for the cameras' column at its top; there these rows are even only because
/// they run past that inset. A Debug build launched with `--expose-occlusions` reports the
/// display's occlusion regions, so the checks that nothing runs under them are real on a Duo and
/// hold trivially on an iPhone with none, or in a build without reserved regions. The suite runs
/// everywhere; run it on a Duo simulator's outer display to prove the column case
/// (`CREWCUE_IOS_SIMULATOR="<Duo simulator>" npm run test:ios`).
@MainActor
final class FullWidthRowsTests: XCTestCase {
    private let route = "crewcue://dev/onboarding-race-preview"
    /// `OcclusionLayout.hysteresis`, plus half a point: a row this close below a region may still
    /// keep the inset it took beside it.
    private let hysteresis = 4.5

    override func setUp() {
        continueAfterFailure = false
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// The replay paused 4 s in: the first beat, on the Map.
    private func launchReplay(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--signed-out", "--expose-occlusions", "--deeplink", "\(route)?at=4&paused=1"] + extra
        app.launch()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview.panel").waitForExistence(timeout: 15), "replay strip missing")
        return app
    }

    /// The display's occlusion regions, margins included, in window points.
    private func occlusions(_ app: XCUIApplication) -> [CGRect] {
        let report = element(app, "crewcue.debug.occlusions")
        guard report.waitForExistence(timeout: 2), report.label != "none" else { return [] }
        return report.label.split(separator: ";").compactMap { rect in
            let numbers = rect.split(separator: ",").compactMap { Double($0) }
            guard numbers.count == 4 else { return nil }
            return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
        }
    }

    /// The region at the top of the display: the cameras' column.
    private func column(_ occlusions: [CGRect]) -> CGRect? {
        occlusions.filter { $0.minY <= 1 }.max { $0.height < $1.height }
    }

    /// Waits for `check` to pass on the element's frame: a row first lays out inside the safe
    /// area, then runs past the column, and a row scrolled beside the column narrows in an
    /// animation. Fails with `problem` on the last frame read.
    private func waitFor(
        _ element: XCUIElement,
        _ name: String,
        file: StaticString,
        line: UInt,
        check: (CGRect) -> Bool,
        problem: (CGRect) -> String
    ) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(name) missing", file: file, line: line)
        var frame = element.frame
        let deadline = Date().addingTimeInterval(5)
        repeat {
            frame = element.frame
            if check(frame) { return }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        XCTFail("\(name) \(frame) \(problem(frame))", file: file, line: line)
    }

    /// The element's gap to the window's left edge equals its gap to the right edge.
    private func assertEvenMargins(
        _ element: XCUIElement,
        in app: XCUIApplication,
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let window = app.windows.firstMatch.frame
        waitFor(element, name, file: file, line: line) { frame in
            abs((frame.minX - window.minX) - (window.maxX - frame.maxX)) <= 1.5
        } problem: { frame in
            "sits \(frame.minX - window.minX) pt from the left edge and \(window.maxX - frame.maxX) pt from the right of \(window)"
        }
    }

    /// No part of the element is under an occlusion region.
    private func assertClear(
        _ element: XCUIElement,
        of occlusions: [CGRect],
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        waitFor(element, name, file: file, line: line) { frame in
            !occlusions.contains { $0.insetBy(dx: 0.5, dy: 0.5).intersects(frame) }
        } problem: { _ in
            "runs under an occlusion region \(occlusions)"
        }
    }

    /// The rule for a row: beside an occlusion region it keeps clear of it; below every region it
    /// runs to both edges alike.
    private func assertFollowsTheColumn(
        _ element: XCUIElement,
        in app: XCUIApplication,
        _ occlusions: [CGRect],
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(name) missing", file: file, line: line)
        let frame = element.frame
        let beside = occlusions.contains { $0.minY < frame.maxY && frame.minY < $0.maxY + hysteresis }
        if beside {
            assertClear(element, of: occlusions, name, file: file, line: line)
        } else {
            assertEvenMargins(element, in: app, name, file: file, line: line)
        }
    }

    /// The aid page in view: the pages sit side by side, and the one in view has its middle
    /// inside the window.
    private func aidPageOnScreen(_ app: XCUIApplication) -> XCUIElement? {
        let window = app.windows.firstMatch.frame
        let deadline = Date().addingTimeInterval(10)
        repeat {
            if let page = app.descendants(matching: .any).matching(identifier: "crewcue.aid-page").allElementsBoundByIndex
                .first(where: { window.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY)) }) {
                return page
            }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        return nil
    }

    func testTheReplaysStripPanesAndAidSheetRunToBothEdges() throws {
        let app = launchReplay()
        let strip = element(app, "crewcue.onboarding-race-preview.panel")
        assertEvenMargins(strip, in: app, "the Map / Pace / Chat strip")
        assertEvenMargins(try XCTUnwrap(aidPageOnScreen(app), "aid page in view"), in: app, "the Map's aid sheet")

        strip.buttons["Pace"].tap()
        assertEvenMargins(element(app, "crewcue.live-eta"), in: app, "Pace's progress header")
        assertEvenMargins(element(app, "crewcue.schedule-sheet"), in: app, "Pace's timeline")

        strip.buttons["Chat"].tap()
        assertEvenMargins(element(app, "crewcue.chat"), in: app, "the Chat pane")
    }

    /// Play, Skip and the caption sit beside the column and keep clear of it, while the strip
    /// below runs past the column's edge.
    func testTheReplaysControlsKeepClearOfTheCameraColumn() {
        let app = launchReplay()
        let occlusions = occlusions(app)
        let strip = element(app, "crewcue.onboarding-race-preview.panel")
        assertEvenMargins(strip, in: app, "the Map / Pace / Chat strip")
        assertClear(element(app, "crewcue.onboarding-race-preview.play-pause"), of: occlusions, "Play")
        assertClear(element(app, "crewcue.onboarding-race-preview.skip"), of: occlusions, "Skip")
        assertClear(element(app, "crewcue.onboarding-race-preview.caption"), of: occlusions, "the caption")
        if let column = column(occlusions) {
            XCTAssertGreaterThan(strip.frame.maxX, column.minX, "the strip \(strip.frame) stops short of the column \(column)")
        }
    }

    /// Right to left the column is on the leading edge; the strip still runs to both edges, and
    /// the controls still keep clear of the column.
    func testTheReplaysStripRunsToBothEdgesRightToLeft() throws {
        let app = launchReplay(["-AppleTextDirection", "YES", "-NSForceRightToLeftWritingDirection", "YES"])
        let occlusions = occlusions(app)
        assertEvenMargins(element(app, "crewcue.onboarding-race-preview.panel"), in: app, "the strip, right to left")
        assertEvenMargins(try XCTUnwrap(aidPageOnScreen(app), "aid page in view"), in: app, "the aid sheet, right to left")
        assertClear(element(app, "crewcue.onboarding-race-preview.play-pause"), of: occlusions, "Play, right to left")
        assertClear(element(app, "crewcue.onboarding-race-preview.skip"), of: occlusions, "Skip, right to left")
    }

    /// The paywall's options run to both edges below the column. Scrolled up, the first option
    /// sits beside the column and narrows to keep clear of it, its Buy button too, while the rows
    /// below still run to both edges; back at the top it runs to both edges again.
    func testThePaywallsRowsFollowTheColumnAsTheyScroll() {
        let app = launchReplay()
        let occlusions = occlusions(app)
        element(app, "crewcue.onboarding-race-preview.skip").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 10), "paywall missing")
        let first = element(app, "crewcue.onboarding-paywall.runner-plus-one")
        let buy = element(app, "crewcue.onboarding-paywall.runner-plus-one.buy")
        let second = element(app, "crewcue.onboarding-paywall.full-crew")
        let notNow = element(app, "crewcue.onboarding-paywall.not-now")
        assertEvenMargins(first, in: app, "You + 1 crew")
        assertEvenMargins(second, in: app, "Your whole crew")

        app.swipeUp()
        XCTAssertTrue(notNow.waitForExistence(timeout: 5), "Not now missing")
        if let column = column(occlusions) {
            XCTAssertLessThan(first.frame.minY, column.maxY, "the swipe should leave You + 1 crew \(first.frame) beside the column \(column)")
        }
        assertFollowsTheColumn(first, in: app, occlusions, "You + 1 crew, scrolled")
        assertClear(buy, of: occlusions, "You + 1 crew's Buy, scrolled")
        assertFollowsTheColumn(second, in: app, occlusions, "Your whole crew, scrolled")
        assertFollowsTheColumn(notNow, in: app, occlusions, "Not now, scrolled")

        app.swipeDown()
        assertEvenMargins(first, in: app, "You + 1 crew, back at the top")
    }

    // MARK: Bar items in the column

    /// No part of `element` is under `item`.
    private func assertClear(
        _ element: XCUIElement,
        ofBarItem item: XCUIElement,
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(item.waitForExistence(timeout: 10), "bar item missing", file: file, line: line)
        waitFor(element, name, file: file, line: line) { frame in
            !item.frame.insetBy(dx: 0.5, dy: 0.5).intersects(frame)
        } problem: { _ in
            "runs under the bar item \(item.frame)"
        }
    }

    /// Signed in with a race and no course: runner setup opens on the course step, and its Back
    /// opens the account step, which has no Back. The bar row collapses, and on iPhone Duo's outer
    /// display the "Your name" field rises beside the account menu, which the system puts in the
    /// camera column. The field keeps clear of the menu, as do the chooser's rows. Needs the local
    /// API (`TEST_RUNNER_CREWCUE_SETUP_API_BASE_URL`), and a dev session for a user with one race
    /// and no course (`TEST_RUNNER_CREWCUE_BAR_USER`, `_TOKEN`, `_ROOM`; see
    /// `OnboardingRunnerSetupFlowTests`).
    func testTheAccountStepsRowsKeepClearOfTheAccountMenu() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let api = environment["CREWCUE_SETUP_API_BASE_URL"],
              let user = environment["CREWCUE_BAR_USER"],
              let token = environment["CREWCUE_BAR_TOKEN"],
              let room = environment["CREWCUE_BAR_ROOM"] else {
            throw XCTSkip("Needs a running API and a dev session for a user with a race and no course.")
        }
        let app = XCUIApplication()
        app.launchArguments = [
            "--expose-occlusions", "--deeplink", "crewcue://dev/app-shell",
            "--api-base-url", api, "--dev-session", user, "athlete", token, room
        ]
        app.launch()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.course").waitForExistence(timeout: 20), "course step missing")
        let back = app.navigationBars.buttons["crewcue.onboarding.back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5), "Back missing on the course step")
        back.tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.account").waitForExistence(timeout: 5), "Back didn't open the account step")
        XCTAssertTrue(waitUntilGone(back, timeout: 5), "the account step shows Back")

        let menu = app.buttons["crewcue.onboarding.account-menu"]
        let occlusions = occlusions(app)
        let name = app.textFields["crewcue.onboarding.display-name"]
        assertClear(name, ofBarItem: menu, "Your name")
        assertClear(name, of: occlusions, "Your name")
        assertClear(app.buttons["crewcue.onboarding.continue"], ofBarItem: menu, "Continue")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "account-step-without-back"
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }
}
