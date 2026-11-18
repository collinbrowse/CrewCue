import SwiftUI
import XCTest

/// `OcclusionLayout` and `OcclusionDisplay`: which safe-area insets a row may run past. The
/// numbers are iPhone Duo's outer display as the iOS 27.2 simulator reports it: 466 x 678 pt, a
/// trailing inset of 84 pt for the whole height, and two occlusion regions with no margins, the
/// camera column (382, 0, 84, 174) and a camera inside it.
final class OcclusionLayoutTests: XCTestCase {
    private let display = CGRect(x: 0, y: 0, width: 466, height: 678)
    private let column = CGRect(x: 382, y: 0, width: 84, height: 174)
    private let camera = CGRect(x: 399.67, y: 29.33, width: 37, height: 37)
    private var regions: [CGRect] { [camera, column] }

    /// A row as the safe area lays it out on that display: from the leading edge to 382.
    private func row(y: CGFloat, height: CGFloat) -> CGRect {
        CGRect(x: 0, y: y, width: 382, height: height)
    }

    private func clear(_ frame: CGRect, leading: CGFloat = 0, trailing: CGFloat = 84, occlusions: [CGRect]? = nil) -> Edge.Set {
        OcclusionLayout.clearEdges(frame: frame, leading: leading, trailing: trailing, occlusions: occlusions ?? regions, displayTop: 0)
    }

    // MARK: clearEdges

    func testARowBelowTheColumnRunsPastTheTrailingInset() {
        // The replay's Map / Pace / Chat strip.
        XCTAssertEqual(clear(row(y: 225, height: 43)), .trailing)
        // The Map's aid sheet at the bottom of the display.
        XCTAssertEqual(clear(row(y: 404.67, height: 275)), .trailing)
    }

    func testARowBesideTheColumnKeepsTheInset() {
        // The replay's Play / Skip row.
        XCTAssertEqual(clear(row(y: 0, height: 76)), [])
        // A row beside the camera alone.
        XCTAssertEqual(clear(row(y: 30, height: 20)), [])
    }

    func testARowThatReachesIntoTheColumnKeepsTheInset() {
        // The caption, from under the controls to below the column's bottom.
        XCTAssertEqual(clear(row(y: 75.75, height: 137.5)), [])
        // One point of overlap is enough.
        XCTAssertEqual(clear(row(y: 173, height: 40)), [])
    }

    func testARowThatOnlyTouchesTheColumnsBottomRunsPastIt() {
        XCTAssertEqual(clear(row(y: 174, height: 40)), .trailing)
    }

    func testTheRegionsMarginsCountAsPartOfIt() {
        // A column that asks for 16 pt of clearance below it.
        let withMargins = OcclusionLayout.outset(column, by: EdgeInsets(top: 0, leading: 0, bottom: 16, trailing: 0))
        XCTAssertEqual(withMargins, CGRect(x: 382, y: 0, width: 84, height: 190))
        XCTAssertEqual(clear(row(y: 180, height: 40), occlusions: [withMargins]), [])
        XCTAssertEqual(clear(row(y: 190, height: 40), occlusions: [withMargins]), .trailing)
    }

    func testOutsetGrowsEverySide() {
        let grown = OcclusionLayout.outset(
            CGRect(x: 10, y: 20, width: 30, height: 40),
            by: EdgeInsets(top: 1, leading: 2, bottom: 3, trailing: 4)
        )
        XCTAssertEqual(grown, CGRect(x: 8, y: 19, width: 36, height: 44))
    }

    func testAnotherRegionLowerOnTheSameEdgeKeepsTheRowsBesideIt() {
        let sensor = CGRect(x: 420, y: 400, width: 30, height: 30)
        XCTAssertEqual(clear(row(y: 380, height: 100), occlusions: regions + [sensor]), [])
        XCTAssertEqual(clear(row(y: 200, height: 100), occlusions: regions + [sensor]), .trailing)
    }

    func testAnInsetWithNoOcclusionRegionsIsKept() {
        // Before reserved regions, or a display that reports none.
        XCTAssertEqual(clear(row(y: 400, height: 100), occlusions: []), [])
    }

    func testAnInsetWithoutAColumnFromTheTopIsKept() {
        // An iPhone held sideways: the Dynamic Island on the leading edge, partway down, and the
        // rounded corners. Its insets are never a camera column.
        let island = CGRect(x: 0, y: 130, width: 37, height: 126)
        let frame = CGRect(x: 62, y: 300, width: 750, height: 50)
        XCTAssertEqual(
            OcclusionLayout.clearEdges(frame: frame, leading: 62, trailing: 62, occlusions: [island], displayTop: 0),
            []
        )
    }

    func testARegionThatDoesNotCoverTheWholeInsetIsNotAColumn() {
        // The camera alone stops 17 pt short of the safe area's edge.
        XCTAssertEqual(clear(row(y: 400, height: 100), occlusions: [camera]), [])
    }

    func testNoInsetMeansNothingToRunPast() {
        let full = CGRect(x: 0, y: 225, width: 466, height: 43)
        XCTAssertEqual(clear(full, trailing: 0), [])
    }

    func testAViewThatStopsShortOfTheSafeAreasEdgeHasNoInsetToRunPast() {
        // A narrow row inside the safe area sees no trailing inset at all.
        XCTAssertEqual(clear(CGRect(x: 24, y: 400, width: 200, height: 40), trailing: 0), [])
    }

    func testEmptyRegionsAreIgnored() {
        XCTAssertEqual(clear(row(y: 0, height: 76), occlusions: [column, .zero, .null]), [])
        XCTAssertEqual(clear(row(y: 300, height: 76), occlusions: [.zero, .null]), [])
    }

    func testALeadingColumnRunsTheLeadingEdge() {
        let leadingColumn = CGRect(x: 0, y: 0, width: 84, height: 174)
        let frame = CGRect(x: 84, y: 300, width: 382, height: 60)
        XCTAssertEqual(
            OcclusionLayout.clearEdges(frame: frame, leading: 84, trailing: 0, occlusions: [leadingColumn], displayTop: 0),
            .leading
        )
        XCTAssertEqual(
            OcclusionLayout.clearEdges(frame: frame.offsetBy(dx: 0, dy: -300), leading: 84, trailing: 0, occlusions: [leadingColumn], displayTop: 0),
            []
        )
    }

    func testTheDisplaysTopIsWhereverItsBoundsStart() {
        let shifted = column.offsetBy(dx: 0, dy: 50)
        XCTAssertEqual(
            OcclusionLayout.clearEdges(frame: row(y: 300, height: 40), leading: 0, trailing: 84, occlusions: [shifted], displayTop: 50),
            .trailing
        )
        XCTAssertEqual(
            OcclusionLayout.clearEdges(frame: row(y: 300, height: 40), leading: 0, trailing: 84, occlusions: [shifted], displayTop: 0),
            []
        )
    }

    // MARK: columnEdges

    func testColumnEdgesDoNotDependOnWhereTheViewSits() {
        // A scroll view that starts at the top still opens its trailing edge; its rows decide.
        let scroll = CGRect(x: 0, y: 0, width: 382, height: 644)
        XCTAssertEqual(
            OcclusionLayout.columnEdges(frame: scroll, leading: 0, trailing: 84, occlusions: regions, displayTop: 0),
            .trailing
        )
        XCTAssertEqual(
            OcclusionLayout.columnEdges(frame: scroll, leading: 0, trailing: 84, occlusions: [], displayTop: 0),
            []
        )
    }

    // MARK: OcclusionDisplay

    func testOcclusionDisplayReadsLeftToRightAsItIs() {
        let screen = OcclusionDisplay(bounds: display, occlusions: regions)
        XCTAssertEqual(
            screen.clearEdges(frame: row(y: 225, height: 43), leading: 0, trailing: 84, layoutDirection: .leftToRight),
            .trailing
        )
        XCTAssertEqual(
            screen.clearEdges(frame: row(y: 0, height: 76), leading: 0, trailing: 84, layoutDirection: .leftToRight),
            []
        )
    }

    func testOcclusionDisplayMirrorsARightToLeftLayout() {
        // Right to left the column is still on the display's right, which is now the leading
        // edge: the simulator reports a leading inset of 84 and the same global frames.
        let screen = OcclusionDisplay(bounds: display, occlusions: regions)
        XCTAssertEqual(
            screen.clearEdges(frame: row(y: 225, height: 43), leading: 84, trailing: 0, layoutDirection: .rightToLeft),
            .leading
        )
        XCTAssertEqual(
            screen.clearEdges(frame: row(y: 0, height: 76), leading: 84, trailing: 0, layoutDirection: .rightToLeft),
            []
        )
        XCTAssertEqual(
            screen.columnEdges(frame: row(y: 0, height: 644), leading: 84, trailing: 0, layoutDirection: .rightToLeft),
            .leading
        )
    }

    // MARK: OcclusionMeasure

    func testAFirstMeasurementIsAlwaysNews() {
        XCTAssertTrue(OcclusionMeasure(frame: .zero, leading: 0, trailing: 0).differs(from: nil))
    }

    func testLayoutNoiseIsNotAChange() {
        // What an animated tab switch on the Duo's outer display reported over and over: two
        // frames 3e-14 pt apart. Storing each one restarted the layout that measured the other.
        let one = OcclusionMeasure(
            frame: CGRect(x: -0.11111111111108585, y: 60, width: 382.2222222222222, height: 500),
            leading: 0,
            trailing: 83.88888888888891
        )
        let other = OcclusionMeasure(
            frame: CGRect(x: -0.11111111111111427, y: 60, width: 382.2222222222222, height: 500),
            leading: 0,
            trailing: 83.88888888888886
        )
        XCTAssertFalse(one.differs(from: other))
        XCTAssertFalse(one.differs(from: OcclusionMeasure(frame: CGRect(x: 0.3, y: 60.4, width: 382, height: 500), leading: 0, trailing: 84)))
    }

    func testMoreThanHalfAPointIsAChange() {
        let base = OcclusionMeasure(frame: CGRect(x: 0, y: 225, width: 382, height: 43), leading: 0, trailing: 84)
        var moved = base
        moved.frame.origin.y += 0.6
        XCTAssertTrue(moved.differs(from: base))
        var resized = base
        resized.frame.size.height += 0.6
        XCTAssertTrue(resized.differs(from: base))
        var inset = base
        inset.trailing = 0
        XCTAssertTrue(inset.differs(from: base))
        var leading = base
        leading.leading = 84
        XCTAssertTrue(leading.differs(from: base))
    }

    func testMirroredFlipsWithinTheBounds() {
        XCTAssertEqual(OcclusionLayout.mirrored(column, in: display), CGRect(x: 0, y: 0, width: 84, height: 174))
        let offset = CGRect(x: 100, y: 0, width: 466, height: 678)
        XCTAssertEqual(
            OcclusionLayout.mirrored(CGRect(x: 482, y: 0, width: 84, height: 174), in: offset),
            CGRect(x: 100, y: 0, width: 84, height: 174)
        )
    }
}
