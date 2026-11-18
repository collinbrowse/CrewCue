import XCTest

/// Rows below a camera column run to both edges alike, and the controls beside the column stay
/// clear of it (`fullWidthClearOfOcclusions()`). On iPhone Duo's outer display iOS insets the
/// whole trailing edge for the cameras' column at its top; there these rows are even only because
/// they run past that inset. Every check holds on any iPhone, so the suite runs everywhere; run it
/// on a Duo simulator's outer display to prove the column case
/// (`CREWCUE_IOS_SIMULATOR="<Duo simulator>" npm run test:ios`).
@MainActor
final class FullWidthRowsTests: XCTestCase {
    private let route = "crewcue://dev/onboarding-race-preview"

    override func setUp() {
        continueAfterFailure = false
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// The replay paused 4 s in: the first beat, on the Map.
    private func launchReplay(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--signed-out", "--deeplink", "\(route)?at=4&paused=1"] + extra
        app.launch()
        XCTAssertTrue(element(app, "crewcue.onboarding-race-preview.panel").waitForExistence(timeout: 15), "replay strip missing")
        return app
    }

    /// The element's gap to the window's left edge equals its gap to the right edge. Waits for the
    /// layout to settle: a row first lays out inside the safe area, then runs past the column.
    private func assertEvenMargins(
        _ element: XCUIElement,
        in app: XCUIApplication,
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(name) missing", file: file, line: line)
        let window = app.windows.firstMatch.frame
        var left = 0.0, right = 0.0
        let deadline = Date().addingTimeInterval(5)
        repeat {
            left = element.frame.minX - window.minX
            right = window.maxX - element.frame.maxX
            if abs(left - right) <= 1.5 { return }
            Thread.sleep(forTimeInterval: 0.25)
        } while Date() < deadline
        XCTFail("\(name) \(element.frame) sits \(left) pt from the left edge and \(right) pt from the right of \(window)", file: file, line: line)
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

    /// Play and Skip sit beside the column: Skip keeps at least Play's gap from its edge (the
    /// same gap with no column, more with one), and never reaches further than the strip below.
    func testTheReplaysControlsKeepClearOfTheCameraColumn() {
        let app = launchReplay()
        let window = app.windows.firstMatch.frame
        let play = element(app, "crewcue.onboarding-race-preview.play-pause")
        let skip = element(app, "crewcue.onboarding-race-preview.skip")
        let strip = element(app, "crewcue.onboarding-race-preview.panel")
        XCTAssertTrue(play.exists && skip.exists, "Play and Skip on screen")
        assertEvenMargins(strip, in: app, "the Map / Pace / Chat strip")
        let playGap = play.frame.minX - window.minX
        let skipGap = window.maxX - skip.frame.maxX
        XCTAssertGreaterThanOrEqual(skipGap, playGap - 1.5, "Skip \(skip.frame) runs closer to its edge than Play \(play.frame)")
        XCTAssertLessThanOrEqual(skip.frame.maxX, strip.frame.maxX + 1.5, "Skip \(skip.frame) runs past the strip \(strip.frame)")
    }

    /// Right to left the column is on the leading edge; the strip still runs to both edges.
    func testTheReplaysStripRunsToBothEdgesRightToLeft() throws {
        let app = launchReplay(["-AppleTextDirection", "YES", "-NSForceRightToLeftWritingDirection", "YES"])
        assertEvenMargins(element(app, "crewcue.onboarding-race-preview.panel"), in: app, "the strip, right to left")
        assertEvenMargins(try XCTUnwrap(aidPageOnScreen(app), "aid page in view"), in: app, "the aid sheet, right to left")
    }

    func testThePaywallsOptionsAndFooterRunToBothEdges() {
        let app = launchReplay()
        element(app, "crewcue.onboarding-race-preview.skip").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-paywall").waitForExistence(timeout: 10), "paywall missing")
        assertEvenMargins(element(app, "crewcue.onboarding-paywall.runner-plus-one"), in: app, "You + 1 crew")
        assertEvenMargins(element(app, "crewcue.onboarding-paywall.full-crew"), in: app, "Your whole crew")

        // Scrolled, a row keeps the width it has at rest.
        let notNow = element(app, "crewcue.onboarding-paywall.not-now")
        app.swipeUp()
        assertEvenMargins(notNow, in: app, "Not now")
        assertEvenMargins(element(app, "crewcue.onboarding-paywall.runner-plus-one"), in: app, "You + 1 crew, scrolled")
    }
}
