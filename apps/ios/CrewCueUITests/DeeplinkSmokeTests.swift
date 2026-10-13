import XCTest

/// Opens every deeplink that `clients/behavior/deeplinks.json` marks as passing on iOS and asserts its accessibility id.
@MainActor
final class DeeplinkSmokeTests: XCTestCase {
    private struct Manifest: Decodable {
        let features: [Feature]
    }

    private struct Feature: Decodable {
        let id: String
        let entry: String
        let label: String
        let ios: String
    }

    func testEveryPassingDeeplinkShowsItsScreen() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "deeplinks", withExtension: "json"))
        let features = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url)).features.filter { $0.ios == "pass" }
        XCTAssertFalse(features.isEmpty, "deeplinks.json has no iOS-passing features")

        let app = XCUIApplication()
        for feature in features {
            XCTContext.runActivity(named: "\(feature.id) via \(feature.entry)") { _ in
                app.launchArguments = ["--deeplink", feature.entry]
                app.launch()
                let element = app.descendants(matching: .any)[feature.label].firstMatch
                XCTAssertTrue(element.waitForExistence(timeout: 10), "\(feature.id): \(feature.label) missing for \(feature.entry)")
            }
        }
    }
}
