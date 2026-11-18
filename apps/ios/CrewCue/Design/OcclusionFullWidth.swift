import SwiftUI

// Lets a row use the display's full width below a camera column, such as iPhone Duo's outer
// display's, while anything the column runs beside keeps clear of it. The geometry is in
// `OcclusionLayout`.
//
// A view only sees the reserved regions that cross its own frame, and a row inside the safe area
// never crosses the column. So `readsOcclusionDisplay()`, at the app's root, reads every occlusion
// region on the window once, and rows compare their own frames with those.
//
// Reserved regions ship in the iOS 27.1 SDK. CI still builds with Xcode 26 (Swift 6.2), so they
// are compiled only by a Swift 6.4 (Xcode 27) toolchain; older toolchains, and systems before
// iOS 27.1, keep today's layout. Drop the `#if`s once CI's Xcode has that SDK.

extension View {
    /// At the app's root: reads the window's occlusion regions for `fullWidthClearOfOcclusions()`
    /// and `OcclusionScrollView` below it.
    func readsOcclusionDisplay() -> some View {
        modifier(OcclusionDisplayReader())
    }

    /// Runs this view past a leading or trailing safe-area inset to the display's edge when that
    /// inset is a camera column (`OcclusionLayout.columnEdges`) and no occlusion region lies
    /// beside the view. A view the column runs beside keeps the inset. Put it outside the row's
    /// own horizontal padding, on a view that reaches the safe area's edge, so the padding moves
    /// with the edge. In an `OcclusionScrollView` the view decides from where it sits with the
    /// scroll at rest, so scrolling never changes its width.
    func fullWidthClearOfOcclusions() -> some View {
        modifier(OcclusionFullWidth())
    }
}

/// Where an `OcclusionScrollView`'s content starts, in global coordinates, with the scroll at
/// rest. Nil until it has been laid out at rest.
struct OcclusionScrollContext: Equatable, Sendable {
    /// The scroll content's coordinate space.
    static let space = "crewcue.occlusion-scroll-content"

    var restingOrigin: CGPoint?
}

extension EnvironmentValues {
    /// Set by `readsOcclusionDisplay()`. Nil before reserved regions, or before the first read.
    @Entry var occlusionDisplay: OcclusionDisplay? = nil
    /// Set by `OcclusionScrollView` for its content.
    @Entry var occlusionScroll: OcclusionScrollContext? = nil
}

/// `readsOcclusionDisplay()`.
struct OcclusionDisplayReader: ViewModifier {
    @State private var display: OcclusionDisplay?

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            content
                .environment(\.occlusionDisplay, display)
                .background {
                    // Measured inside `ignoresSafeArea`, on the whole window: a view only sees the
                    // regions that cross it.
                    Color.clear
                        .onGeometryChange(for: OcclusionDisplay.self) { proxy in
                            let bounds = proxy.frame(in: .global)
                            return OcclusionDisplay(
                                bounds: bounds,
                                occlusions: proxy.reservedRegions(kind: .occlusion, layoutDirectionBehavior: .fixed).map { region in
                                    // The region plus the clearance it asks for around it.
                                    OcclusionLayout.outset(region.frame, by: region.margins)
                                        .offsetBy(dx: bounds.minX, dy: bounds.minY)
                                }
                            )
                        } action: { next in
                            display = next
                        }
                        .ignoresSafeArea()
                }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// `fullWidthClearOfOcclusions()`.
struct OcclusionFullWidth: ViewModifier {
    @Environment(\.occlusionDisplay) private var display
    @Environment(\.occlusionScroll) private var scroll
    @Environment(\.layoutDirection) private var layoutDirection
    /// The view's frame (global, or in its scroll view's content) and its insets.
    @State private var row: OcclusionMeasure?

    /// Stores a measurement with no animation. A measured frame that fed an animated layout
    /// change would be measured again at every step of that animation.
    static func store(_ update: () -> Void) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction, update)
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            content
                .ignoresSafeArea(.container, edges: edges)
                // Measured outside `ignoresSafeArea`: the frame the safe area gives the view and
                // its insets stay the same whether or not it runs past them, so the decision
                // can't flip-flop. In a scroll view the frame is read in the content, which
                // scrolling doesn't move.
                .background {
                    Color.clear.onGeometryChange(for: OcclusionMeasure.self) { [inScroll = scroll != nil] proxy in
                        OcclusionMeasure(
                            frame: inScroll ? proxy.frame(in: .named(OcclusionScrollContext.space)) : proxy.frame(in: .global),
                            leading: proxy.safeAreaInsets.leading,
                            trailing: proxy.safeAreaInsets.trailing
                        )
                    } action: { next in
                        if next.differs(from: row) {
                            OcclusionFullWidth.store { row = next }
                        }
                    }
                }
        } else {
            content
        }
        #else
        content
        #endif
    }

    private var edges: Edge.Set {
        guard let display, let row else { return [] }
        var frame = row.frame
        if let scroll {
            guard let origin = scroll.restingOrigin else { return [] }
            frame = frame.offsetBy(dx: origin.x, dy: origin.y)
        }
        return display.clearEdges(frame: frame, leading: row.leading, trailing: row.trailing, layoutDirection: layoutDirection)
    }
}

/// A vertical `ScrollView` whose rows can use `fullWidthClearOfOcclusions()`. A scroll view clips
/// its content, so where its safe-area inset is a camera column it runs to the display's edge
/// itself and gives its content that inset back as safe area: rows that don't use the modifier,
/// and the scroll indicator, stay where they were. Elsewhere it is a plain `ScrollView`.
struct OcclusionScrollView<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            OcclusionColumnScrollView(content: content)
        } else {
            ScrollView { content }
        }
        #else
        ScrollView { content }
        #endif
    }
}

#if compiler(>=6.4)
@available(iOS 27.1, *)
private struct OcclusionColumnScrollView<Content: View>: View {
    let content: Content
    @Environment(\.occlusionDisplay) private var display
    @Environment(\.layoutDirection) private var layoutDirection
    /// The scroll view's frame as the safe area lays it out, global, and its insets.
    @State private var frame = OcclusionMeasure(frame: .zero, leading: 0, trailing: 0)
    /// The scroll is at its resting position (the top).
    @State private var atRest = true
    @State private var restingOrigin: CGPoint?

    var body: some View {
        let opened = display?.columnEdges(
            frame: frame.frame,
            leading: frame.leading,
            trailing: frame.trailing,
            layoutDirection: layoutDirection
        ) ?? []
        let leading = opened.contains(.leading) ? frame.leading : 0
        let trailing = opened.contains(.trailing) ? frame.trailing : 0
        ScrollView {
            content
                .safeAreaPadding(.leading, leading)
                .safeAreaPadding(.trailing, trailing)
                .coordinateSpace(.named(OcclusionScrollContext.space))
                // Where the content starts at rest. Read only at rest: scrolling moves it.
                .background {
                    Color.clear.onGeometryChange(for: CGPoint.self) { proxy in
                        proxy.frame(in: .global).origin
                    } action: { origin in
                        guard atRest else { return }
                        if let resting = restingOrigin, abs(resting.x - origin.x) <= 0.5, abs(resting.y - origin.y) <= 0.5 {
                            return
                        }
                        OcclusionFullWidth.store { restingOrigin = origin }
                    }
                }
        }
        .contentMargins(.leading, leading, for: .scrollIndicators)
        .contentMargins(.trailing, trailing, for: .scrollIndicators)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            abs(geometry.contentOffset.y + geometry.contentInsets.top) < 0.5
                && abs(geometry.contentOffset.x + geometry.contentInsets.leading) < 0.5
        } action: { _, rest in
            atRest = rest
        }
        .environment(\.occlusionScroll, OcclusionScrollContext(restingOrigin: restingOrigin))
        .ignoresSafeArea(.container, edges: opened)
        // Measured outside `ignoresSafeArea`, so opening the scroll view doesn't move it.
        .background {
            Color.clear.onGeometryChange(for: OcclusionMeasure.self) { proxy in
                OcclusionMeasure(
                    frame: proxy.frame(in: .global),
                    leading: proxy.safeAreaInsets.leading,
                    trailing: proxy.safeAreaInsets.trailing
                )
            } action: { next in
                // The insets measured here go back into the layout as `safeAreaPadding`: store
                // only real changes, unanimated, or the two can chase each other forever.
                if next.differs(from: frame) {
                    OcclusionFullWidth.store { frame = next }
                }
            }
        }
    }
}
#endif
