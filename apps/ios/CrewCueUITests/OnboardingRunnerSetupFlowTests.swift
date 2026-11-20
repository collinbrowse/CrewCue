import XCTest

/// Runner setup signed in (clients/behavior/onboarding-runner-setup.md) against a running API:
/// the race name, the course loader, Back between steps with what was entered kept, and the
/// history step's tips. It needs a server and a dev session for a user with no race yet, so it is
/// skipped unless the run names them:
///
///     TEST_RUNNER_CREWCUE_SETUP_API_BASE_URL=http://127.0.0.1:3187 \
///     TEST_RUNNER_CREWCUE_SETUP_USER=<new user id> TEST_RUNNER_CREWCUE_SETUP_TOKEN=<HS256 dev JWT> \
///     xcodebuild test ... -only-testing:CrewCueUITests/OnboardingRunnerSetupFlowTests
///
/// with the API in memory mode on HS256 dev JWTs, and fixtures/pacing/course-50k-with-aids.gpx in
/// the simulator's Files > On My iPhone. Screenshots of each step go into the result bundle.
/// `TEST_RUNNER_CREWCUE_SETUP_SLOW_PREVIEW=1` (with the API behind a proxy that holds
/// `POST .../course/gpx-preview` for a few seconds) also checks the loader while it shows.
@MainActor
final class OnboardingRunnerSetupFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }

    private func swipeFromLeadingEdge(_ app: XCUIApplication) {
        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5))
        edge.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
    }

    /// Picks `name` in the system file picker, from Recents or Browse > On My iPhone.
    private func pickFile(_ app: XCUIApplication, _ name: String) {
        let file = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
        if file.waitForExistence(timeout: 5) {
            file.tap()
            return
        }
        if app.buttons["Browse"].exists { app.buttons["Browse"].tap() }
        let onPhone = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "On My iPhone")).firstMatch
        if onPhone.waitForExistence(timeout: 5) { onPhone.tap() }
        XCTAssertTrue(file.waitForExistence(timeout: 5), "\(name) missing from the picker")
        file.tap()
    }

    func testRaceNameLoaderBackAndHistoryTips() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let api = environment["CREWCUE_SETUP_API_BASE_URL"],
              let user = environment["CREWCUE_SETUP_USER"],
              let token = environment["CREWCUE_SETUP_TOKEN"] else {
            throw XCTSkip("Needs a running API and a dev session for a new user (see the class comment).")
        }
        let app = XCUIApplication()
        app.launchArguments = ["--deeplink", "crewcue://dev/app-shell", "--api-base-url", api, "--dev-session", user, "athlete", token]
        app.launch()

        let runner = element(app, "crewcue.onboarding.chooser.runner")
        XCTAssertTrue(runner.waitForExistence(timeout: 15), "chooser missing")
        runner.tap()

        // Account: the runner's own name, not the race's.
        let name = app.textFields["crewcue.onboarding.display-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10), "name field missing")
        XCTAssertTrue(app.staticTexts["Your name"].exists)
        XCTAssertTrue(app.staticTexts["Your crew sees this in chat."].exists)
        XCTAssertTrue(app.staticTexts["Create an account or sign in, then add your name."].exists)
        name.tap()
        name.typeText("Ada Runner")
        keep(app, "account")
        app.buttons["crewcue.onboarding.continue"].tap()

        // Course: the race name comes first, and the file waits for it.
        XCTAssertTrue(element(app, "crewcue.onboarding.step.course").waitForExistence(timeout: 10), "course step missing")
        let raceName = app.textFields["crewcue.onboarding.race-name"]
        XCTAssertTrue(raceName.exists, "race name field missing")
        XCTAssertEqual(raceName.placeholderValue, "Western States 2026")
        XCTAssertTrue(app.staticTexts["Race name"].exists)
        XCTAssertTrue(app.staticTexts["Your race and the year, or a fun name for your crew."].exists)
        let choose = app.buttons["crewcue.onboarding.choose-course"]
        XCTAssertFalse(choose.isEnabled, "Choose course file waits for the race name")
        raceName.tap()
        raceName.typeText("Canyons 2027")
        XCTAssertTrue(choose.isEnabled)
        keep(app, "course-named")

        // Back to the account step and forward again keeps both names.
        let back = app.navigationBars.buttons["crewcue.onboarding.back"]
        XCTAssertTrue(back.exists, "Back missing from the navigation bar")
        back.tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.account").waitForExistence(timeout: 5), "Back didn't open the account step")
        XCTAssertEqual(name.value as? String, "Ada Runner")
        app.buttons["crewcue.onboarding.continue"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.course").waitForExistence(timeout: 5))
        XCTAssertEqual(raceName.value as? String, "Canyons 2027")

        // The file: the loader in the preview's place until the map and profile are ready.
        choose.tap()
        pickFile(app, "course-50k-with-aids")
        // A local API answers the preview faster than a snapshot reads the screen; behind a proxy
        // that holds the preview (CREWCUE_SETUP_SLOW_PREVIEW=1) the loader is always seen.
        let loader = element(app, "crewcue.onboarding.course-loading")
        if environment["CREWCUE_SETUP_SLOW_PREVIEW"] == "1" {
            XCTAssertTrue(loader.waitForExistence(timeout: 10), "no loader while the course loads")
            keep(app, "course-loading")
            XCTAssertEqual(loader.label, "Reading your course…")
            // The preview under the loader stays hidden, to VoiceOver as well.
            XCTAssertFalse(element(app, "crewcue.onboarding.course-map").exists, "the map shows before the loader ends")
        }
        XCTAssertTrue(waitUntilGone(loader, timeout: 20), "the loader never gave way to the preview")
        XCTAssertTrue(element(app, "crewcue.onboarding.course-map").exists)
        XCTAssertTrue(element(app, "crewcue.onboarding.elevation-profile").exists)
        keep(app, "course-preview")

        // The race exists now: its name is read-only.
        XCTAssertFalse(app.textFields["crewcue.onboarding.race-name"].exists, "the race name is still editable")
        XCTAssertEqual(element(app, "crewcue.onboarding.race-name").value as? String, "Canyons 2027")

        app.buttons["crewcue.onboarding.continue"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.startTime").waitForExistence(timeout: 10), "start time missing")
        // Back to the course keeps the file and its preview.
        back.tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.course").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "crewcue.onboarding.course-file").exists, "the picked file was lost")
        XCTAssertTrue(element(app, "crewcue.onboarding.course-map").exists)
        app.buttons["crewcue.onboarding.continue"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.startTime").waitForExistence(timeout: 5))
        app.buttons["crewcue.onboarding.continue"].tap()

        // History: the lead, then which file, the formats, and that it's optional.
        XCTAssertTrue(element(app, "crewcue.onboarding.step.history").waitForExistence(timeout: 20), "history step missing")
        XCTAssertTrue(element(app, "crewcue.onboarding.history-tips").exists)
        for tip in [
            "Pick a recent race or long run your watch recorded, ideally on terrain like your race.",
            "Use a .gpx, .fit or .tcx file up to 10 MB. Garmin Connect, COROS and many other watch apps can export one.",
            "It's optional. Skip it for a rough estimate from your course alone. You can add past runs later in Settings."
        ] {
            XCTAssertTrue(app.staticTexts[tip].exists, tip)
        }
        keep(app, "history")

        // The edge swipe goes back too; Continue on the unchanged start doesn't save it again.
        swipeFromLeadingEdge(app)
        XCTAssertTrue(element(app, "crewcue.onboarding.step.startTime").waitForExistence(timeout: 5), "the edge swipe didn't go back")
        app.buttons["crewcue.onboarding.continue"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.history").waitForExistence(timeout: 10))
        app.buttons["crewcue.onboarding.skip-history"].tap()
        XCTAssertTrue(element(app, "crewcue.onboarding.step.projectionTeaser").waitForExistence(timeout: 20), "teaser missing")
        XCTAssertTrue(back.exists, "Back shows on the teaser")
        keep(app, "teaser")
    }
}
