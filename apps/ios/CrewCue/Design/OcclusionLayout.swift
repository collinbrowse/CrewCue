import SwiftUI

// The geometry behind `fullWidthClearOfOcclusions()` and `OcclusionScrollView`. Pure functions on
// rects, so CrewCueTests compiles this file on its own: keep it free of other app code.

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
        let values = [frame.minX, frame.minY, frame.maxX, frame.maxY, leading, trailing]
        let others = [other.frame.minX, other.frame.minY, other.frame.maxX, other.frame.maxY, other.leading, other.trailing]
        return zip(values, others).contains { abs($0 - $1) > 0.5 }
    }
}
