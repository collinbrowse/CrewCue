import XCTest

/// The signed-out entry (clients/behavior/onboarding-runner-setup.md): the chooser, the runner's
/// account step, a relaunch resuming it, and crew going to the join screen.
@MainActor
final class OnboardingEntryTests: XCTestCase {
    private let entry = ["--signed-out", "--deeplink", "crewcue://dev/app-shell"]

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// A pick saved by an earlier run resumes past the chooser; go back to it.
    private func openChooser(_ app: XCUIApplication) {
        app.launchArguments = entry
        app.launch()
        let chooser = element(app, "crewcue.onboarding-chooser")
        if chooser.waitForExistence(timeout: 5) { return }
        for back in ["crewcue.onboarding.back", "Back"] where app.buttons[back].exists {
            app.buttons[back].tap()
            break
        }
        XCTAssertTrue(chooser.waitForExistence(timeout: 5), "chooser missing")
    }

    func testRunnerChoiceOpensTheAccountStepAndARelaunchResumesIt() {
        let app = XCUIApplication()
        openChooser(app)
        XCTAssertTrue(element(app, "crewcue.onboarding.chooser.crew").exists)
        XCTAssertTrue(element(app, "crewcue.onboarding.chooser.sign-in").exists)

        element(app, "crewcue.onboarding.chooser.runner").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-runner-setup").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "crewcue.onboarding.step.account").exists)
        XCTAssertTrue(element(app, "crewcue.onboarding.create-account").exists)
        XCTAssertTrue(element(app, "crewcue.onboarding.sign-in").exists)

        // The pick is saved: a relaunch opens the account step, not the chooser.
        app.terminate()
        app.launchArguments = entry
        app.launch()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.account").waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "crewcue.onboarding-chooser").exists)

        // Back clears the pick.
        element(app, "crewcue.onboarding.back").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5))
    }

    /// Back is the navigation bar's standard back button, and the edge swipe goes back too.
    func testBackIsANavigationBarButtonAndTheEdgeSwipeAlsoGoesBack() {
        let app = XCUIApplication()
        openChooser(app)
        element(app, "crewcue.onboarding.chooser.runner").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.account").waitForExistence(timeout: 5))

        let back = app.navigationBars.buttons["crewcue.onboarding.back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5), "Back sits in the navigation bar")
        XCTAssertEqual(back.label, "Back")
        XCTAssertLessThan(back.frame.midX, app.frame.midX, "Back is the bar's leading item")

        // The bar draws a 36 pt glass button, like every bar button; its target is at least 44 pt,
        // so a tap 3 pt below the glass still goes back.
        let below = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: back.frame.midX, dy: back.frame.maxY + 3))
        below.tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5), "Back's target is under 44 pt")

        // From the first step, the swipe from the leading edge returns to the chooser too.
        element(app, "crewcue.onboarding.chooser.runner").tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.account").waitForExistence(timeout: 5))
        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5), "the edge swipe goes back")
    }

    func testCrewChoiceOpensTheJoinScreenAndBackReturnsToTheChooser() {
        let app = XCUIApplication()
        openChooser(app)
        element(app, "crewcue.onboarding.chooser.crew").tap()
        XCTAssertTrue(element(app, "crewcue.join-crew").waitForExistence(timeout: 5))
        app.buttons["Back"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5))
    }
}
