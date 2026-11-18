import SwiftUI

// The geometry behind `fullWidthClearOfOcclusions()` and `OcclusionScrollView`: pure functions on
// rects, and the tracker that turns a view's measurements into decisions. CrewCueTests compiles
// this file on its own: keep it free of other app code.

/// iPhone Duo's outer display keeps its camera and status icons in a column at the top of its
/// trailing edge (84 x 174 pt on the 466 x 678 pt display). iOS reports that column as a trailing
/// safe-area inset for the display's whole height, so a view that respects the safe area stops
/// short of the edge even far below the column. These decide where a view may run past such an
/// inset to the display's edge.
enum OcclusionLayout {
    /// Within this many points, two edges count as the same edge.
    static let tolerance: CGFloat = 1

    /// The leading and trailing safe-area insets `frame` can ignore: those that are a camera
    /// column (`columnEdges`) where no occlusion region lies in the strip the view would take
    /// past the inset, from its top to its bottom.
    ///
    /// - Parameters:
    ///   - frame: the view as the safe area lays it out (not run past any inset).
    ///   - leading: how far the display's leading edge is past `frame`'s leading edge.
    ///   - trailing: how far the display's trailing edge is past `frame`'s trailing edge.
    ///   - occlusions: the occlusion regions' frames, margins included (`outset`).
    ///   - displayTop: the display's top edge.
    ///
    ///   Every rect and edge is in one coordinate space, with x growing toward the trailing edge.
    nonisolated static func clearEdges(
        frame: CGRect,
        leading: CGFloat,
        trailing: CGFloat,
        occlusions: [CGRect],
        displayTop: CGFloat
    ) -> Edge.Set {
        var edges = columnEdges(frame: frame, leading: leading, trailing: trailing, occlusions: occlusions, displayTop: displayTop)
        let regions = regions(occlusions)
        if edges.contains(.leading) {
            let strip = CGRect(x: frame.minX - leading, y: frame.minY, width: leading, height: frame.height)
            if regions.contains(where: { overlaps($0, strip) }) { edges.remove(.leading) }
        }
        if edges.contains(.trailing) {
            let strip = CGRect(x: frame.maxX, y: frame.minY, width: trailing, height: frame.height)
            if regions.contains(where: { overlaps($0, strip) }) { edges.remove(.trailing) }
        }
        return edges
    }

    /// How far past every region a view that keeps an inset must be before it runs past it again.
    /// A view that runs past an inset keeps it again as soon as it meets a region.
    static let hysteresis: CGFloat = 4

    /// `clearEdges` for a view that moves, such as a row in a scroll view, given what it decided
    /// last (`current`, nil before its first decision).
    ///
    /// - Only the part of `frame` between `visible`'s top and bottom counts, since a scroll view
    ///   clips the rest. A view with none of it in sight keeps `current`, so a row scrolled out of
    ///   sight above the column doesn't change its width, and so its height, under the rows still
    ///   in sight.
    /// - An edge `current` keeps the inset on opens only once the strip past it is `hysteresis`
    ///   clear of every region; an edge it runs past closes as soon as the strip meets a region.
    ///   So a row resting or bouncing at the column's bottom edge can't flip back and forth, and
    ///   never runs under the column.
    nonisolated static func nextEdges(
        current: Edge.Set?,
        frame: CGRect,
        visible: CGRect?,
        leading: CGFloat,
        trailing: CGFloat,
        occlusions: [CGRect],
        displayTop: CGFloat,
        hysteresis: CGFloat = OcclusionLayout.hysteresis
    ) -> Edge.Set {
        var shown = frame
        if let visible {
            let top = max(frame.minY, visible.minY)
            let bottom = min(frame.maxY, visible.maxY)
            guard bottom > top else {
                return current ?? clearEdges(frame: frame, leading: leading, trailing: trailing, occlusions: occlusions, displayTop: displayTop)
            }
            shown = CGRect(x: frame.minX, y: top, width: frame.width, height: bottom - top)
        }
        let edges = clearEdges(frame: shown, leading: leading, trailing: trailing, occlusions: occlusions, displayTop: displayTop)
        guard let current else { return edges }
        // A taller frame only meets more regions, so `settled` is within `edges`.
        let settled = clearEdges(
            frame: shown.insetBy(dx: 0, dy: -hysteresis),
            leading: leading,
            trailing: trailing,
            occlusions: occlusions,
            displayTop: displayTop
        )
        return edges.intersection(current).union(settled)
    }

    /// The leading and trailing safe-area insets that are a camera column: an occlusion region
    /// that starts at the display's top edge and covers the inset from the safe area's edge to
    /// the display's edge. Where the view sits doesn't matter here. An inset with no such
    /// column (a notch or rounded corners, as on an iPhone held sideways) is never one.
    nonisolated static func columnEdges(
        frame: CGRect,
        leading: CGFloat,
        trailing: CGFloat,
        occlusions: [CGRect],
        displayTop: CGFloat
    ) -> Edge.Set {
        var edges: Edge.Set = []
        let fromTop = regions(occlusions).filter { $0.minY <= displayTop + tolerance }
        if leading > tolerance, fromTop.contains(where: { region in
            region.minX <= frame.minX - leading + tolerance && region.maxX >= frame.minX - tolerance
        }) {
            edges.insert(.leading)
        }
        if trailing > tolerance, fromTop.contains(where: { region in
            region.minX <= frame.maxX + tolerance && region.maxX >= frame.maxX + trailing - tolerance
        }) {
            edges.insert(.trailing)
        }
        return edges
    }

    /// A region's frame grown by the clearance it asks for around it. `margins` are read the
    /// way `frame` is laid out: leading is the low-x side.
    nonisolated static func outset(_ frame: CGRect, by margins: EdgeInsets) -> CGRect {
        CGRect(
            x: frame.minX - margins.leading,
            y: frame.minY - margins.top,
            width: frame.width + margins.leading + margins.trailing,
            height: frame.height + margins.top + margins.bottom
        )
    }

    /// `rect` flipped left to right within `bounds`: a right-to-left layout's rects in the
    /// left-to-right space `clearEdges` and `columnEdges` take.
    nonisolated static func mirrored(_ rect: CGRect, in bounds: CGRect) -> CGRect {
        CGRect(x: bounds.minX + bounds.maxX - rect.maxX, y: rect.minY, width: rect.width, height: rect.height)
    }

    /// `rect` has moved or resized by more than half a point since `other`, or there was no
    /// `other`. Smaller changes are layout noise.
    nonisolated static func differs(_ rect: CGRect, from other: CGRect?) -> Bool {
        guard let other else { return true }
        let values = [rect.minX, rect.minY, rect.maxX, rect.maxY]
        let others = [other.minX, other.minY, other.maxX, other.maxY]
        return zip(values, others).contains { abs($0 - $1) > 0.5 }
    }

    /// The two share some area. Rects that only touch don't.
    private nonisolated static func overlaps(_ a: CGRect, _ b: CGRect) -> Bool {
        a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
    }

    /// Regions with an area, in standard form.
    private nonisolated static func regions(_ occlusions: [CGRect]) -> [CGRect] {
        occlusions.map(\.standardized).filter { !$0.isNull && !$0.isInfinite && $0.width > 0 && $0.height > 0 }
    }
}

/// The window's occlusion regions, margins included, and its bounds, in global coordinates.
/// Global x grows to the right whatever the layout direction, as do the regions (read with
/// `layoutDirectionBehavior: .fixed`); a view's leading and trailing insets follow the layout
/// direction, so a right-to-left layout is mirrored before the edges are worked out.
struct OcclusionDisplay: Equatable, Sendable {
    var bounds: CGRect
    var occlusions: [CGRect]

    /// The edges `frame` can run past its `leading` and `trailing` insets on
    /// (`OcclusionLayout.clearEdges`), read the way `layoutDirection` lays them out.
    nonisolated func clearEdges(frame: CGRect, leading: CGFloat, trailing: CGFloat, layoutDirection: LayoutDirection) -> Edge.Set {
        let flip = layoutDirection == .rightToLeft
        return OcclusionLayout.clearEdges(
            frame: flip ? OcclusionLayout.mirrored(frame, in: bounds) : frame,
            leading: leading,
            trailing: trailing,
            occlusions: flip ? occlusions.map { OcclusionLayout.mirrored($0, in: bounds) } : occlusions,
            displayTop: bounds.minY
        )
    }

    /// The edges a moving view runs past next (`OcclusionLayout.nextEdges`), read the way
    /// `layoutDirection` lays them out. Only `visible`'s top and bottom count.
    nonisolated func nextEdges(
        current: Edge.Set?,
        frame: CGRect,
        visible: CGRect?,
        leading: CGFloat,
        trailing: CGFloat,
        layoutDirection: LayoutDirection
    ) -> Edge.Set {
        let flip = layoutDirection == .rightToLeft
        return OcclusionLayout.nextEdges(
            current: current,
            frame: flip ? OcclusionLayout.mirrored(frame, in: bounds) : frame,
            visible: visible,
            leading: leading,
            trailing: trailing,
            occlusions: flip ? occlusions.map { OcclusionLayout.mirrored($0, in: bounds) } : occlusions,
            displayTop: bounds.minY
        )
    }

    /// The edges whose inset is a camera column, wherever `frame` sits
    /// (`OcclusionLayout.columnEdges`).
    nonisolated func columnEdges(frame: CGRect, leading: CGFloat, trailing: CGFloat, layoutDirection: LayoutDirection) -> Edge.Set {
        let flip = layoutDirection == .rightToLeft
        return OcclusionLayout.columnEdges(
            frame: flip ? OcclusionLayout.mirrored(frame, in: bounds) : frame,
            leading: leading,
            trailing: trailing,
            occlusions: flip ? occlusions.map { OcclusionLayout.mirrored($0, in: bounds) } : occlusions,
            displayTop: bounds.minY
        )
    }
}

/// A view's frame and its leading and trailing safe-area insets, as a geometry change reads them.
struct OcclusionMeasure: Equatable, Sendable {
    var frame: CGRect
    var leading: CGFloat
    var trailing: CGFloat

    /// Moved, resized or inset by more than half a point. Smaller changes are layout noise, or
    /// the steps of an animation that storing them would restart, and none of them can change a
    /// decision `OcclusionLayout` makes to within a point.
    nonisolated func differs(from other: OcclusionMeasure?) -> Bool {
        guard let other else { return true }
        return OcclusionLayout.differs(frame, from: other.frame) || insetsDiffer(from: other)
    }

    /// The leading or trailing inset changed by more than half a point, or there was no `other`.
    nonisolated func insetsDiffer(from other: OcclusionMeasure?) -> Bool {
        guard let other else { return true }
        return abs(leading - other.leading) > 0.5 || abs(trailing - other.trailing) > 0.5
    }
}

/// A change to the edges a view runs past (`OcclusionTracker.decide`).
struct OcclusionChange: Equatable {
    var edges: Edge.Set
    /// How the view gets there: nil for its first decision with a layout, which lands at once.
    var animation: Animation?

    /// A view that keeps an inset again narrows quickly: until it has, it runs under the region it
    /// just met.
    static let narrowing = Animation.snappy(duration: 0.15)
    /// A view that runs past an inset again opens with the usual spring.
    static let reopening = Animation.snappy
}

/// A view's latest measurement, and whether it has decided with the layout it has now
/// (`fullWidthClearOfOcclusions()`). Not view state: in a scroll view the measurement changes every
/// frame, and only the decision it leads to should update the view.
final class OcclusionTracker {
    private(set) var measure: OcclusionMeasure?
    /// The view has decided with the layout it has now. Its next decision after a new layout is a
    /// first one: no hysteresis, no animation.
    private(set) var decided = false

    /// Stores the view's latest measurement. New insets are a new layout: an
    /// `OcclusionScrollView` first lays its rows out with none, then a pass later runs to the
    /// display's edge and gives them the column's inset back. That isn't the row moving.
    func measured(_ next: OcclusionMeasure) {
        if next.insetsDiffer(from: measure) { decided = false }
        measure = next
    }

    /// The scroll view's viewport changed from `old`. The first one is a new layout too: until it
    /// arrives a row counts its whole frame, not just the part in sight.
    func viewportChanged(from old: CGRect?) {
        if old == nil { decided = false }
    }

    /// A new display is a new layout.
    func displayChanged() {
        decided = false
    }

    /// Decides from the latest measurement for a view that runs past `current` now. The first
    /// decision with a layout uses no hysteresis and doesn't animate; later ones, as the view
    /// moves, do. Nil before there is a display and a measurement, or when the edges stay.
    func decide(
        current: Edge.Set,
        display: OcclusionDisplay?,
        viewport: CGRect?,
        layoutDirection: LayoutDirection
    ) -> OcclusionChange? {
        guard let display, let measure else { return nil }
        let first = !decided
        decided = true
        let next = display.nextEdges(
            current: first ? nil : current,
            frame: measure.frame,
            visible: viewport?.intersection(display.bounds),
            leading: measure.leading,
            trailing: measure.trailing,
            layoutDirection: layoutDirection
        )
        guard next != current else { return nil }
        if first { return OcclusionChange(edges: next, animation: nil) }
        let narrows = !current.subtracting(next).isEmpty
        return OcclusionChange(edges: next, animation: narrows ? OcclusionChange.narrowing : OcclusionChange.reopening)
    }
}
