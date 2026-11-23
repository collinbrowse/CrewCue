import XCTest

/// The signed-out entry (clients/behavior/onboarding-runner-setup.md): the chooser, the runner's
/// account step, a relaunch resuming it, crew going to the join screen, and sign-in's Back.
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

    func testCrewChoiceOpensTheJoinScreenAndBackReturnsToTheChooser() {
        let app = XCUIApplication()
        openChooser(app)
        element(app, "crewcue.onboarding.chooser.crew").tap()
        XCTAssertTrue(element(app, "crewcue.join-crew").waitForExistence(timeout: 5))
        app.buttons["Back"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5))
    }

    /// "I already have an account" opens sign-in with the bar's Back, which returns to the chooser
    /// with every choice still there; so does the swipe from the leading edge, and Back still
    /// works after join's Back returns to sign-in (clients/behavior/auth-sign-in.md).
    func testSignInFromTheChooserGoesBackToTheChooser() {
        let app = XCUIApplication()
        openChooser(app)
        let chooser = element(app, "crewcue.onboarding-chooser")
        let signedOut = element(app, "crewcue.auth-signed-out")

        element(app, "crewcue.onboarding.chooser.sign-in").tap()
        XCTAssertTrue(signedOut.waitForExistence(timeout: 5))
        XCTAssertFalse(chooser.exists)
        let back = app.navigationBars.buttons["crewcue.auth-sign-in.back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5), "Back sits in the navigation bar")
        XCTAssertEqual(back.label, "Back")
        XCTAssertLessThan(back.frame.midX, app.frame.midX, "Back is the bar's leading item")

        back.tap()
        XCTAssertTrue(chooser.waitForExistence(timeout: 5), "Back didn't return to the chooser")
        XCTAssertFalse(signedOut.exists)
        for choice in ["runner", "crew", "sign-in"] {
            XCTAssertTrue(element(app, "crewcue.onboarding.chooser.\(choice)").exists, "\(choice) missing after Back")
        }

        // The swipe from the leading edge goes back too.
        element(app, "crewcue.onboarding.chooser.sign-in").tap()
        XCTAssertTrue(signedOut.waitForExistence(timeout: 5))
        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        XCTAssertTrue(chooser.waitForExistence(timeout: 5), "the edge swipe didn't go back")

        // Join with a code, its Back, then sign-in's Back: still the chooser.
        element(app, "crewcue.onboarding.chooser.sign-in").tap()
        XCTAssertTrue(signedOut.waitForExistence(timeout: 5))
        app.buttons["Join your crew with a code"].tap()
        XCTAssertTrue(element(app, "crewcue.join-crew").waitForExistence(timeout: 5))
        app.buttons["Back"].firstMatch.tap()
        XCTAssertTrue(signedOut.waitForExistence(timeout: 5))
        app.navigationBars.buttons["crewcue.auth-sign-in.back"].tap()
        XCTAssertTrue(chooser.waitForExistence(timeout: 5))
    }

    /// The dev link opens sign-in with nothing behind it in the flow: Back opens the app's own
    /// launch, the chooser, the same screen sign-out lands on.
    func testSignInFromItsDevLinkGoesBackToTheChooser() {
        let app = XCUIApplication()
        openChooser(app)
        app.terminate()
        app.launchArguments = ["--signed-out", "--deeplink", "crewcue://dev/auth-signed-out"]
        app.launch()
        XCTAssertTrue(element(app, "crewcue.auth-signed-out").waitForExistence(timeout: 10))
        let back = app.navigationBars.buttons["crewcue.auth-sign-in.back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5))
    }
}
