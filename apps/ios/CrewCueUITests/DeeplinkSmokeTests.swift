import XCTest

/// Opens every feature deeplink in `clients/behavior/deeplinks.json` and asserts its accessibility id.
/// Runs regardless of checklist status: a row is `pass` only with device proof, but every screen must still open.
@MainActor
final class DeeplinkSmokeTests: XCTestCase {
    private struct Manifest: Decodable {
        let features: [Feature]
    }

    private struct Feature: Decodable {
        let id: String
        let entry: String
        let label: String
    }

    /// Rows whose checklist screen exists only when signed in. Signed out, `app-shell` shows sign-in instead.
    private static let signedInFeatures: Set<String> = ["app-shell"]

    func testEveryDeeplinkShowsItsScreen() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "deeplinks", withExtension: "json"))
        let features = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url)).features
        XCTAssertFalse(features.isEmpty, "deeplinks.json lists no features")

        let app = XCUIApplication()
        for feature in features {
            XCTContext.runActivity(named: "\(feature.id) via \(feature.entry)") { _ in
                // A session left on the simulator would open the product shell instead of the screen under test.
                let session = Self.signedInFeatures.contains(feature.id) ? ["--dev-session", "smoke-user", "crew"] : ["--signed-out"]
                app.launchArguments = session + ["--deeplink", feature.entry]
                app.launch()
                let element = app.descendants(matching: .any)[feature.label].firstMatch
                XCTAssertTrue(element.waitForExistence(timeout: 10), "\(feature.id): \(feature.label) missing for \(feature.entry)")
            }
        }
    }
}
