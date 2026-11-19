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

    // MARK: nextEdges

    private func next(
        _ frame: CGRect,
        current: Edge.Set?,
        visible: CGRect? = CGRect(x: 0, y: 0, width: 466, height: 644)
    ) -> Edge.Set {
        OcclusionLayout.nextEdges(
            current: current,
            frame: frame,
            visible: visible,
            leading: 0,
            trailing: 84,
            occlusions: regions,
            displayTop: 0
        )
    }

    func testAFirstDecisionIsClearEdgesOnWhatIsInSight() {
        XCTAssertEqual(next(row(y: 207, height: 171), current: nil), .trailing)
        XCTAssertEqual(next(row(y: 167, height: 117), current: nil), [])
        // With no hysteresis: a row that only touches the column's bottom runs past it.
        XCTAssertEqual(next(row(y: 174, height: 40), current: nil), .trailing)
    }

    func testARowScrolledUpBesideTheColumnKeepsTheInset() {
        // The paywall's first option, scrolled from 207 pt to 24 pt: it ran past the inset at
        // rest, and must not stay that wide beside the column.
        XCTAssertEqual(next(row(y: 207, height: 171), current: nil), .trailing)
        XCTAssertEqual(next(row(y: 24, height: 171), current: .trailing), [])
        // One point beside it is enough.
        XCTAssertEqual(next(row(y: 173, height: 60), current: .trailing), [])
    }

    func testARowScrolledBackBelowTheColumnRunsPastItOnceItIsClear() {
        // Back below the column, but within the hysteresis: still inset.
        XCTAssertEqual(next(row(y: 176, height: 60), current: []), [])
        XCTAssertEqual(next(row(y: 177.5, height: 60), current: []), [])
        // Clear by the hysteresis: full width again.
        XCTAssertEqual(next(row(y: 178, height: 60), current: []), .trailing)
        XCTAssertEqual(next(row(y: 300, height: 60), current: []), .trailing)
    }

    func testARowAlreadyFullWidthStaysSoUntilItMeetsTheColumn() {
        XCTAssertEqual(next(row(y: 175, height: 60), current: .trailing), .trailing)
        XCTAssertEqual(next(row(y: 174, height: 60), current: .trailing), .trailing)
        XCTAssertEqual(next(row(y: 173.5, height: 60), current: .trailing), [])
    }

    func testOnlyThePartInSightCounts() {
        // A transcript that starts above the scroll view's top, 186 pt, below the column: what
        // the scroll view clips can't sit under the column.
        let transcript = row(y: -400, height: 900)
        let below = CGRect(x: 0, y: 186, width: 466, height: 392)
        XCTAssertEqual(next(transcript, current: nil, visible: below), .trailing)
        XCTAssertEqual(next(transcript, current: .trailing, visible: below), .trailing)
        // A scroll view that starts beside the column: the same transcript keeps the inset.
        let beside = CGRect(x: 0, y: 100, width: 466, height: 478)
        XCTAssertEqual(next(transcript, current: .trailing, visible: beside), [])
        // Outside a scroll view the whole frame counts.
        XCTAssertEqual(next(transcript, current: nil, visible: nil), [])
    }

    func testARowOutOfSightKeepsWhatItDecided() {
        // Scrolled off the top: it was beside the column on the way out, and stays inset, so its
        // height can't change and move the rows still in sight.
        XCTAssertEqual(next(row(y: -300, height: 171), current: []), [])
        // Below the scroll view's bottom, it keeps its full width.
        XCTAssertEqual(next(row(y: 700, height: 60), current: .trailing), .trailing)
        // Never decided and out of sight: the whole frame decides.
        XCTAssertEqual(next(row(y: 700, height: 60), current: nil), .trailing)
        XCTAssertEqual(next(row(y: 700, height: 60), current: nil, visible: .null), .trailing)
    }

    func testNextEdgesFollowsTheColumnRightToLeft() {
        let screen = OcclusionDisplay(bounds: display, occlusions: regions)
        let visible = CGRect(x: 0, y: 0, width: 466, height: 644)
        XCTAssertEqual(
            screen.nextEdges(current: nil, frame: row(y: 300, height: 60), visible: visible, leading: 84, trailing: 0, layoutDirection: .rightToLeft),
            .leading
        )
        XCTAssertEqual(
            screen.nextEdges(current: .leading, frame: row(y: 100, height: 60), visible: visible, leading: 84, trailing: 0, layoutDirection: .rightToLeft),
            []
        )
    }

    func testRectsDifferByMoreThanHalfAPoint() {
        let rect = CGRect(x: 0, y: 186, width: 466, height: 392)
        XCTAssertTrue(OcclusionLayout.differs(rect, from: nil))
        XCTAssertFalse(OcclusionLayout.differs(rect, from: rect.offsetBy(dx: 0.4, dy: -0.4)))
        XCTAssertTrue(OcclusionLayout.differs(rect, from: rect.offsetBy(dx: 0, dy: 0.6)))
        XCTAssertFalse(OcclusionLayout.differs(rect, from: rect.insetBy(dx: 0, dy: 0.3)))
        XCTAssertTrue(OcclusionLayout.differs(rect, from: CGRect(x: 0, y: 186, width: 466, height: 392.6)))
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

    func testInsetsDifferByMoreThanHalfAPoint() {
        let base = OcclusionMeasure(frame: CGRect(x: 0, y: 225, width: 382, height: 43), leading: 0, trailing: 84)
        XCTAssertTrue(base.insetsDiffer(from: nil))
        var moved = base
        moved.frame.origin.y = 24
        XCTAssertFalse(moved.insetsDiffer(from: base), "moving isn't new insets")
        var noise = base
        noise.trailing = 83.6
        XCTAssertFalse(noise.insetsDiffer(from: base))
        var none = base
        none.trailing = 0
        XCTAssertTrue(none.insetsDiffer(from: base))
        var leading = base
        leading.leading = 0.6
        XCTAssertTrue(leading.insetsDiffer(from: base))
    }

    // MARK: OcclusionTracker

    private var duo: OcclusionDisplay { OcclusionDisplay(bounds: display, occlusions: regions) }
    /// The paywall's scroll view, below the status bar: what it shows of the window.
    private let viewport = CGRect(x: 0, y: 0, width: 466, height: 644)

    private func measure(_ frame: CGRect, trailing: CGFloat = 84) -> OcclusionMeasure {
        OcclusionMeasure(frame: frame, leading: 0, trailing: trailing)
    }

    private func decide(_ tracker: OcclusionTracker, current: Edge.Set, viewport: CGRect?) -> OcclusionChange? {
        tracker.decide(current: current, display: duo, viewport: viewport, layoutDirection: .leftToRight)
    }

    func testNothingIsDecidedBeforeADisplayAndAMeasurement() {
        let tracker = OcclusionTracker()
        XCTAssertNil(decide(tracker, current: [], viewport: viewport))
        XCTAssertFalse(tracker.decided)
        tracker.measured(measure(row(y: 207, height: 171)))
        XCTAssertNil(tracker.decide(current: [], display: nil, viewport: viewport, layoutDirection: .leftToRight))
        XCTAssertFalse(tracker.decided)
    }

    func testAScrollViewOpeningToTheEdgeIsANewLayoutNotAMove() {
        // A new OcclusionScrollView lays its rows out once inside the safe area, before it has
        // measured itself: no inset, and no viewport yet.
        let tracker = OcclusionTracker()
        tracker.measured(measure(row(y: 207, height: 171), trailing: 0))
        XCTAssertNil(decide(tracker, current: [], viewport: nil), "no inset, nothing to run past")
        XCTAssertTrue(tracker.decided)
        // A pass later it runs to the display's edge and gives the row the column's inset back.
        // The row hasn't moved: it lands full width at once instead of sliding open.
        tracker.measured(measure(row(y: 207, height: 171)))
        XCTAssertFalse(tracker.decided)
        XCTAssertEqual(decide(tracker, current: [], viewport: nil), OcclusionChange(edges: .trailing, animation: nil))
        // The viewport arriving changes nothing for this row.
        tracker.viewportChanged(from: nil)
        XCTAssertNil(decide(tracker, current: .trailing, viewport: viewport))
    }

    func testAViewportArrivingIsANewLayoutNotAMove() {
        // The paid Chat transcript: taller than its scroll view, which starts below the column.
        // Until the viewport arrives its whole frame counts, and that reaches beside the column.
        let below = CGRect(x: 0, y: 186, width: 466, height: 392)
        let tracker = OcclusionTracker()
        tracker.measured(measure(row(y: -400, height: 900)))
        XCTAssertNil(decide(tracker, current: [], viewport: nil))
        // With the viewport only the part in sight counts: it lands full width at once.
        tracker.viewportChanged(from: nil)
        XCTAssertFalse(tracker.decided)
        XCTAssertEqual(decide(tracker, current: [], viewport: below), OcclusionChange(edges: .trailing, animation: nil))
        // A viewport that only moves is no new layout.
        tracker.viewportChanged(from: below)
        XCTAssertTrue(tracker.decided)
    }

    func testANewDisplayIsANewLayout() {
        let tracker = OcclusionTracker()
        tracker.measured(measure(row(y: 207, height: 171)))
        XCTAssertNil(tracker.decide(current: [], display: OcclusionDisplay(bounds: display, occlusions: []), viewport: viewport, layoutDirection: .leftToRight))
        tracker.displayChanged()
        XCTAssertFalse(tracker.decided)
        XCTAssertEqual(decide(tracker, current: [], viewport: viewport), OcclusionChange(edges: .trailing, animation: nil))
    }

    func testARowNarrowsQuicklyAndOpensAgainWithASpring() {
        let tracker = OcclusionTracker()
        tracker.measured(measure(row(y: 207, height: 171)))
        XCTAssertEqual(decide(tracker, current: [], viewport: viewport), OcclusionChange(edges: .trailing, animation: nil))
        // Scrolled up beside the column: the same layout, so it moves, and narrows quickly, since
        // until it has it runs under the column.
        tracker.measured(measure(row(y: 24, height: 171)))
        XCTAssertTrue(tracker.decided)
        XCTAssertEqual(decide(tracker, current: .trailing, viewport: viewport), OcclusionChange(edges: [], animation: OcclusionChange.narrowing))
        // Scrolled back below it: it opens again with the usual spring.
        tracker.measured(measure(row(y: 300, height: 171)))
        XCTAssertEqual(decide(tracker, current: [], viewport: viewport), OcclusionChange(edges: .trailing, animation: OcclusionChange.reopening))
        // Inset noise is no new layout: still a move.
        tracker.measured(OcclusionMeasure(frame: row(y: 24, height: 171), leading: 0, trailing: 83.7))
        XCTAssertEqual(decide(tracker, current: .trailing, viewport: viewport), OcclusionChange(edges: [], animation: OcclusionChange.narrowing))
    }

    func testNarrowingIsShortAndReopeningIsTheUsualSpring() {
        XCTAssertEqual(OcclusionChange.narrowing, Animation.snappy(duration: 0.15))
        XCTAssertEqual(OcclusionChange.reopening, Animation.snappy)
        XCTAssertNotEqual(OcclusionChange.narrowing, OcclusionChange.reopening)
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
