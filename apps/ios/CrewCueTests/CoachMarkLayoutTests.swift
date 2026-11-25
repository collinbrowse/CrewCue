import SwiftUI
import XCTest

/// `CoachMarkLayout`: where a tour card sits next to the control it points at. Frames are the
/// tab bar's buttons as the shell lays them out on a standard iPhone (402 x 874 pt), iPhone Duo's
/// inner display (951 x 669 pt) and a bar down the side of a display.
final class CoachMarkLayoutTests: XCTestCase {
    func testABottomTabSendsTheCardAboveIt() {
        let bounds = CGRect(x: 16, y: 70, width: 370, height: 760)
        let profile = CGRect(x: 290, y: 770, width: 100, height: 60)
        XCTAssertEqual(CoachMarkLayout.side(anchor: profile, in: bounds), .above)
        let region = CoachMarkLayout.region(side: .above, anchor: profile, in: bounds)
        XCTAssertEqual(region.alignment, .bottom)
        XCTAssertEqual(region.rect.maxY, profile.minY - CoachMarkLayout.spacing)
        // The card stays inside the margins even though the tab is at the trailing edge.
        XCTAssertGreaterThanOrEqual(region.rect.minX, bounds.minX)
        XCTAssertLessThanOrEqual(region.rect.maxX, bounds.maxX)
    }

    func testTheWideInnerDisplayStillPutsTheCardAboveABottomTab() {
        let bounds = CGRect(x: 16, y: 8, width: 860, height: 640)
        let map = CGRect(x: 20, y: 590, width: 240, height: 60)
        XCTAssertEqual(CoachMarkLayout.side(anchor: map, in: bounds), .above)
        let region = CoachMarkLayout.region(side: .above, anchor: map, in: bounds)
        XCTAssertEqual(region.rect.width, CoachMarkLayout.maxWidth)
        XCTAssertEqual(region.rect.minX, bounds.minX, "clamped to the leading margin, centred on the tab where it can be")
    }

    func testABarDownTheSideSendsTheCardBesideIt() {
        let bounds = CGRect(x: 16, y: 8, width: 860, height: 640)
        let tab = CGRect(x: 20, y: 300, width: 80, height: 60)
        // Tall room above and below would win; a short display leaves only the side.
        let short = CGRect(x: 16, y: 200, width: 860, height: 260)
        XCTAssertEqual(CoachMarkLayout.side(anchor: tab, in: short), .trailing)
        let region = CoachMarkLayout.region(side: .trailing, anchor: tab, in: short)
        XCTAssertEqual(region.rect.minX, tab.maxX + CoachMarkLayout.spacing)
        XCTAssertEqual(CoachMarkLayout.side(anchor: tab, in: bounds), .above)
    }

    func testNoAnchorCentresTheCard() {
        let bounds = CGRect(x: 16, y: 8, width: 370, height: 760)
        XCTAssertEqual(CoachMarkLayout.side(anchor: nil, in: bounds), .center)
        let region = CoachMarkLayout.region(side: .center, anchor: nil, in: bounds)
        XCTAssertEqual(region.alignment, .center)
        XCTAssertEqual(region.rect.midX, bounds.midX)
    }
}
