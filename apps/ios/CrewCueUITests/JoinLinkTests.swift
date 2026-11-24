import XCTest

/// Join links (clients/behavior/join-link.md): the join page's https link and `crewcue://join/<code>`
/// open the join screen with the code, and a link without a code asks for Paste or typing. No API
/// runs here, so the race preview itself is proved on the simulator against a local server.
@MainActor
final class JoinLinkTests: XCTestCase {
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    private func launchSignedOut() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--signed-out", "--deeplink", "crewcue://dev/app-shell"]
        app.launch()
        return app
    }

    /// Back gives the invite up, so the saved code doesn't open the join screen in later tests.
    private func leaveJoin(_ app: XCUIApplication) {
        let back = element(app, "crewcue.join-crew.back")
        if back.waitForExistence(timeout: 3) { back.tap() }
    }

    private func assertJoinScreen(_ app: XCUIApplication, code: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element(app, "crewcue.join-crew").waitForExistence(timeout: 10), "join screen missing", file: file, line: line)
        let field = app.textFields["Invite code"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), file: file, line: line)
        XCTAssertEqual(field.value as? String, code, file: file, line: line)
        XCTAssertTrue(element(app, "crewcue.join-crew.paste").exists, "paste row missing", file: file, line: line)
    }

    func testJoinPageLinkOpensTheJoinScreenWithItsCode() throws {
        let app = launchSignedOut()
        let link = try XCTUnwrap(URL(string: "https://collinbrowse.github.io/crewcue/join/?code=123456"))
        app.open(link)
        assertJoinScreen(app, code: "123456")
        // Signed out, Join becomes sign-up.
        XCTAssertTrue(app.buttons["Sign up to join"].exists)
        leaveJoin(app)
    }

    func testAppSchemeLinkOpensTheJoinScreenWithItsCode() throws {
        let app = launchSignedOut()
        app.open(try XCTUnwrap(URL(string: "crewcue://join/654321")))
        assertJoinScreen(app, code: "654321")
        leaveJoin(app)
    }

    func testLinkWithoutACodeAsksForPasteOrTyping() throws {
        let app = launchSignedOut()
        app.open(try XCTUnwrap(URL(string: "crewcue://join/")))
        XCTAssertTrue(element(app, "crewcue.join-crew").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["That link didn't include an invite code. Paste it or type the 6 digits."].waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "crewcue.join-crew.paste").exists)
        leaveJoin(app)
    }
}
