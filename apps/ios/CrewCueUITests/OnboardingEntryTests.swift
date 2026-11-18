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

    func testCrewChoiceOpensTheJoinScreenAndBackReturnsToTheChooser() {
        let app = XCUIApplication()
        openChooser(app)
        element(app, "crewcue.onboarding.chooser.crew").tap()
        XCTAssertTrue(element(app, "crewcue.join-crew").waitForExistence(timeout: 5))
        app.buttons["Back"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding-chooser").waitForExistence(timeout: 5))
    }
}
