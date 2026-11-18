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
    /// beside the view. A view the column runs beside keeps the inset. The view decides again
    /// whenever it moves, so a row scrolled up beside the column narrows to keep clear of it, and
    /// the change animates. Put it outside the row's own horizontal padding, on a view that
    /// reaches the safe area's edge, so the padding moves with the edge. In a scroll view, put it
    /// on each row rather than on the whole content: a view keeps the inset while any of it in
    /// sight is beside the column.
    func fullWidthClearOfOcclusions() -> some View {
        modifier(OcclusionFullWidth())
    }
}

extension EnvironmentValues {
    /// Set by `readsOcclusionDisplay()`. Nil before reserved regions, or before the first read.
    @Entry var occlusionDisplay: OcclusionDisplay? = nil
    /// Set by `OcclusionScrollView` for its content: the part of the window it shows, global. A
    /// row's part outside it is clipped, so it can't be under the column.
    @Entry var occlusionScrollViewport: CGRect? = nil
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
                #if DEBUG
                .overlay(alignment: .topLeading) {
                    if OcclusionDebugLabel.enabled, let display {
                        OcclusionDebugLabel(display: display)
                    }
                }
                #endif
        } else {
            content
        }
        #else
        content
        #endif
    }
}

#if DEBUG
/// UI tests launched with `--expose-occlusions` read the window's occlusion regions here, in
/// window points, so they can check that nothing a person needs runs under the column
/// (`FullWidthRowsTests`). "none" when the display has none.
private struct OcclusionDebugLabel: View {
    static let enabled = CommandLine.arguments.contains("--expose-occlusions")
    let display: OcclusionDisplay

    var body: some View {
        let rects = display.occlusions.map { rect in
            [rect.minX, rect.minY, rect.width, rect.height].map { String(format: "%.2f", $0) }.joined(separator: ",")
        }
        Text(verbatim: rects.isEmpty ? "none" : rects.joined(separator: ";"))
            .font(.system(size: 1))
            .foregroundStyle(.clear)
            .frame(width: 1, height: 1)
            .allowsHitTesting(false)
            .accessibilityIdentifier("crewcue.debug.occlusions")
    }
}
#endif

/// A view's latest measurement. Not view state: in a scroll view it changes every frame, and only
/// the decision it leads to should update the view.
final class OcclusionTracker {
    var measure: OcclusionMeasure?
    /// The view has decided with the display it has now.
    var decided = false
}

/// `fullWidthClearOfOcclusions()`.
struct OcclusionFullWidth: ViewModifier {
    @Environment(\.occlusionDisplay) private var display
    @Environment(\.occlusionScrollViewport) private var viewport
    @Environment(\.layoutDirection) private var layoutDirection
    /// The edges the view runs past. Changes only when the decision does.
    @State private var open: Edge.Set = []
    @State private var tracker = OcclusionTracker()

    /// Stores a measurement or a first decision with no animation. A measured frame that fed an
    /// animated layout change would be measured again at every step of that animation.
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
                .ignoresSafeArea(.container, edges: open)
                // Measured outside `ignoresSafeArea`: the frame the safe area gives the view and
                // its insets stay the same whether or not it runs past them, so the decision
                // can't feed back into the frame it's made from.
                .background {
                    Color.clear.onGeometryChange(for: OcclusionMeasure.self) { proxy in
                        OcclusionMeasure(
                            frame: proxy.frame(in: .global),
                            leading: proxy.safeAreaInsets.leading,
                            trailing: proxy.safeAreaInsets.trailing
                        )
                    } action: { next in
                        tracker.measure = next
                        decide()
                    }
                }
                .onChange(of: display) {
                    tracker.decided = false
                    decide()
                }
                .onChange(of: viewport) {
                    decide()
                }
        } else {
            content
        }
        #else
        content
        #endif
    }

    /// Decides from the latest measurement. The first decision with a display is made without
    /// animation and without hysteresis; later ones, as the view moves, animate.
    private func decide() {
        guard let display, let measure = tracker.measure else { return }
        let first = !tracker.decided
        tracker.decided = true
        let next = display.nextEdges(
            current: first ? nil : open,
            frame: measure.frame,
            visible: viewport?.intersection(display.bounds),
            leading: measure.leading,
            trailing: measure.trailing,
            layoutDirection: layoutDirection
        )
        guard next != open else { return }
        if first {
            OcclusionFullWidth.store { open = next }
        } else {
            withAnimation(.snappy) { open = next }
        }
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
    /// The part of the window the scroll view shows: its frame, run up and down under any top or
    /// bottom inset it may scroll its content under.
    @State private var viewport: CGRect?

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
        }
        .contentMargins(.leading, leading, for: .scrollIndicators)
        .contentMargins(.trailing, trailing, for: .scrollIndicators)
        .environment(\.occlusionScrollViewport, viewport)
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
            .onGeometryChange(for: CGRect.self) { proxy in
                let global = proxy.frame(in: .global)
                let insets = proxy.safeAreaInsets
                return CGRect(
                    x: global.minX,
                    y: global.minY - insets.top,
                    width: global.width,
                    height: global.height + insets.top + insets.bottom
                )
            } action: { next in
                if OcclusionLayout.differs(next, from: viewport) {
                    OcclusionFullWidth.store { viewport = next }
                }
            }
        }
    }
}
#endif
