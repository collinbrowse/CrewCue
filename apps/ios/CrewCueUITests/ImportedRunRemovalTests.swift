import XCTest

/// Settings → Pace estimate → Imported runs (clients/behavior/activity-import.md): swipe a run,
/// cancel, swipe again, confirm Remove run, see the list reload without it, then Recalculate the
/// runner's race. It needs a server and a dev session for a runner with a race and three imported
/// runs, so it is skipped unless the run names them:
///
///     TEST_RUNNER_CREWCUE_RUNS_API_BASE_URL=http://127.0.0.1:3877 \
///     TEST_RUNNER_CREWCUE_RUNS_USER=<user id> TEST_RUNNER_CREWCUE_RUNS_TOKEN=<HS256 dev JWT> \
///     TEST_RUNNER_CREWCUE_RUNS_ROOM=<room id> \
///     xcodebuild test ... -only-testing:CrewCueUITests/ImportedRunRemovalTests
///
/// with the API in memory mode on HS256 dev JWTs. Screenshots of each step go into the result bundle.
@MainActor
final class ImportedRunRemovalTests: XCTestCase {
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

    private func runCount(_ app: XCUIApplication) -> Int {
        app.descendants(matching: .any).matching(identifier: "crewcue.activity-import.run").count
    }

    private func waitForRunCount(_ app: XCUIApplication, _ count: Int, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if runCount(app) == count { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return runCount(app) == count
    }

    private func swipeFirstRun(_ app: XCUIApplication) {
        let row = app.descendants(matching: .any).matching(identifier: "crewcue.activity-import.run").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no imported run row")
        row.swipeLeft()
        let remove = app.buttons["crewcue.activity-import.remove"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "no Remove swipe action")
        keep(app, "2-swiped")
        remove.tap()
    }

    func testSwipeConfirmRemovesTheRunAndOffersRecalculate() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let api = environment["CREWCUE_RUNS_API_BASE_URL"],
              let user = environment["CREWCUE_RUNS_USER"],
              let token = environment["CREWCUE_RUNS_TOKEN"],
              let room = environment["CREWCUE_RUNS_ROOM"] else {
            throw XCTSkip("Needs a running API and a runner with imported runs (see the class comment).")
        }
        let app = XCUIApplication()
        app.launchArguments = [
            "--deeplink", "crewcue://dev/activity-import", "--api-base-url", api,
            "--dev-session", user, "athlete", token, room
        ]
        app.launch()

        let runs = element(app, "crewcue.activity-import.runs")
        XCTAssertTrue(runs.waitForExistence(timeout: 20), "no run count row in Settings")
        XCTAssertTrue(runs.label.contains("3 runs imported"), runs.label)
        runs.tap()
        XCTAssertTrue(waitForRunCount(app, 3), "expected 3 runs, saw \(runCount(app))")
        keep(app, "1-imported-runs")

        // Cancel keeps the run.
        swipeFirstRun(app)
        let alert = app.alerts["Remove this run?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "no confirm")
        XCTAssertTrue(alert.staticTexts["It will no longer shape your pace estimate. You can import the file again later."].exists)
        keep(app, "3-confirm")
        alert.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(waitForRunCount(app, 3), "Cancel removed a run")

        // Remove run deletes it on the server and the list reloads without it.
        swipeFirstRun(app)
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["Remove run"].firstMatch.tap()
        XCTAssertTrue(waitForRunCount(app, 2), "expected 2 runs after removing, saw \(runCount(app))")
        let status = element(app, "crewcue.activity-import.removal-status")
        XCTAssertTrue(status.waitForExistence(timeout: 10), "no removal status")
        XCTAssertEqual(status.label, "Run removed. Recalculate your estimate without it?")
        let recalculate = element(app, "crewcue.activity-import.recalculate")
        XCTAssertTrue(recalculate.waitForExistence(timeout: 5), "no Recalculate offer")
        keep(app, "4-removed")

        recalculate.tap()
        let recalculated = NSPredicate(format: "label == %@", "Estimate recalculated. Open Pace to see it.")
        XCTAssertEqual(
            XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: recalculated, object: status)], timeout: 20),
            .completed,
            "status after Recalculate: \(status.label)"
        )
        XCTAssertFalse(recalculate.exists)
        keep(app, "5-recalculated")

        // Reopening shows the server's list: the run stays gone.
        element(app, "crewcue.activity-import.done").tap()
        XCTAssertTrue(runs.waitForExistence(timeout: 10))
        XCTAssertTrue(runs.label.contains("2 runs imported"), runs.label)
        runs.tap()
        XCTAssertTrue(waitForRunCount(app, 2))
        XCTAssertFalse(element(app, "crewcue.activity-import.removal-status").exists)
        keep(app, "6-reopened")
    }
}
