import XCTest

/// The launch splash ends while the screen under it animates. On iOS 27 SwiftUI's async renderer
/// drives that animation off the main thread, and it used to re-run the window's main-actor closure
/// there when the splash ended: Swift 6's isolation check trapped (EXC_BREAKPOINT) in about half of
/// these launches. The race-day replay's progress bar is the animation that exposed it.
@MainActor
final class LaunchSplashTests: XCTestCase {
    private let entry = ["--signed-out", "--deeplink", "crewcue://dev/onboarding-race-preview", "--launch-splash"]

    func testSplashEndsOverAnAnimatingScreenWithoutCrashing() {
        let app = XCUIApplication()
        for attempt in 1...5 {
            app.launchArguments = entry
            app.launch()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10), "launch \(attempt) never came up")
            // The splash takes about 2 s from first frame; a crash at its end shows up well inside this.
            XCTAssertFalse(app.wait(for: .notRunning, timeout: 6), "launch \(attempt): the app died as the splash ended")
            app.terminate()
        }
    }
}
