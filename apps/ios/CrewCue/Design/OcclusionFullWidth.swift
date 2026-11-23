import SwiftUI
import UIKit

// Lets a row use the display's full width below a camera column, such as iPhone Duo's outer
// display's, while anything the column runs beside keeps clear of it. The geometry is in
// `OcclusionLayout`.
//
// A view only sees the reserved regions that cross its own frame, and a row inside the safe area
// never crosses the column. So `readsOcclusionDisplay()`, at the app's root, reads every occlusion
// region on the window once, and rows compare their own frames with those.
//
// The system also places bar items in the column: iPhone Duo's outer display floats a trailing
// toolbar item there, below the cameras. They aren't occlusion regions, so the reader also finds
// the bar's controls (`OcclusionBarScanner`), and a bar item SwiftUI hosts itself reports its own
// frame (`keepsFullWidthRowsClear()`). Rows beside either keep the inset too.
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
    /// whenever it moves, so a row scrolled up beside the column narrows to keep clear of it,
    /// quickly, and opens again with a spring once clear. Its first decision in a new layout
    /// doesn't animate, so a row doesn't slide as it appears. Put it outside the row's own
    /// horizontal padding, on a view that reaches the safe area's edge, so the padding moves with
    /// the edge. In a scroll view, put it on each row rather than on the whole content: a view
    /// keeps the inset while any of it in sight is beside the column.
    func fullWidthClearOfOcclusions() -> some View {
        modifier(OcclusionFullWidth())
    }

    /// On a bar item whose label is a custom view, which the bar hosts as is, so the reader's
    /// scan for the bar's controls doesn't find it: rows using `fullWidthClearOfOcclusions()`
    /// beside it keep clear of it, as of the camera. Its frame, grown by
    /// `OcclusionLayout.barItemClearance`, counts until it leaves the hierarchy. A plain `Label`,
    /// `Text` or `Image` item (a button or a menu) needs nothing: the bar draws it as a control.
    func keepsFullWidthRowsClear() -> some View {
        modifier(OcclusionObstacleReporter())
    }
}

/// Where `keepsFullWidthRowsClear()` reports a frame (global, nil once it's gone), keyed by its
/// own id. Set by `readsOcclusionDisplay()`.
struct OcclusionObstacleSink: Sendable {
    var report: @MainActor @Sendable (UUID, CGRect?) -> Void
}

extension EnvironmentValues {
    /// Set by `readsOcclusionDisplay()`. Nil before reserved regions, or before the first read.
    @Entry var occlusionDisplay: OcclusionDisplay? = nil
    /// Set by `readsOcclusionDisplay()`: where `keepsFullWidthRowsClear()` reports.
    @Entry var occlusionObstacleSink: OcclusionObstacleSink? = nil
    /// Set by `readsOcclusionDisplay()`: finds the bar's controls again when a row's layout changes.
    @Entry var occlusionBarScanner: OcclusionBarScanner? = nil
    /// Set by `OcclusionScrollView` for its content: the part of the window it shows, global. A
    /// row's part outside it is clipped, so it can't be under the column.
    @Entry var occlusionScrollViewport: CGRect? = nil
}

/// `readsOcclusionDisplay()`.
struct OcclusionDisplayReader: ViewModifier {
    /// The window's bounds and occlusion regions, as last read.
    @State private var regions: OcclusionDisplay?
    /// The frames `keepsFullWidthRowsClear()` reported, by reporter.
    @State private var obstacles: [UUID: CGRect] = [:]
    /// The bar's controls, as last found.
    @State private var barControls: [CGRect] = []
    @State private var scanner = OcclusionBarScanner()

    /// `regions` with the bar's controls and the reported obstacles, in a stable order so an
    /// unchanged set compares equal.
    private var display: OcclusionDisplay? {
        guard var display = regions else { return nil }
        display.obstacles = barControls + obstacles.sorted { $0.key.uuidString < $1.key.uuidString }.map(\.value)
        return display
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            content
                .environment(\.occlusionDisplay, display)
                .environment(\.occlusionBarScanner, scanner)
                .environment(\.occlusionObstacleSink, OcclusionObstacleSink { id, frame in
                    guard let frame else {
                        if obstacles[id] != nil { OcclusionFullWidth.store { obstacles[id] = nil } }
                        return
                    }
                    if OcclusionLayout.differs(frame, from: obstacles[id]) {
                        OcclusionFullWidth.store { obstacles[id] = frame }
                    }
                })
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
                            regions = next
                        }
                        .ignoresSafeArea()
                }
                .background {
                    OcclusionBarScanProbe(scanner: scanner, bounds: regions?.bounds)
                        .ignoresSafeArea()
                }
                .onAppear {
                    scanner.found = { controls in
                        let changed = controls.count != barControls.count
                            || zip(controls, barControls).contains { OcclusionLayout.differs($0, from: $1) }
                        if changed { OcclusionFullWidth.store { barControls = controls } }
                    }
                    scanner.scheduleScan()
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
/// UI tests launched with `--expose-occlusions` read the window's occlusion regions here, then
/// the bar items rows keep clear of (`OcclusionDisplay.obstacles`), in window points, so they can
/// check that nothing a person needs runs under the column (`FullWidthRowsTests`). "none" when
/// the display has neither.
private struct OcclusionDebugLabel: View {
    static let enabled = CommandLine.arguments.contains("--expose-occlusions")
    let display: OcclusionDisplay

    var body: some View {
        let rects = (display.occlusions + display.obstacles).map { rect in
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

/// `keepsFullWidthRowsClear()`.
struct OcclusionObstacleReporter: ViewModifier {
    @Environment(\.occlusionObstacleSink) private var sink
    @Environment(\.occlusionDisplay) private var display

    @ViewBuilder
    func body(content: Content) -> some View {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *), let sink {
            // Measured in UIKit: a bar item is hosted on its own, and SwiftUI's global space
            // there is the item's, not the window's.
            content.background(OcclusionObstacleProbe(sink: sink, bounds: display?.bounds))
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// Reports the frame of the view it backs, in window coordinates (the space `readsOcclusionDisplay()`
/// measures in), whenever it lays out, moves to a window or the display changes, and nil once
/// it's gone.
private struct OcclusionObstacleProbe: UIViewRepresentable {
    let sink: OcclusionObstacleSink
    /// The display's bounds: a new display can move the item without laying it out again.
    let bounds: CGRect?

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.sink = sink
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.sink = sink
        // After this layout pass, once the bar has placed the item.
        DispatchQueue.main.async { view.report() }
    }

    static func dismantleUIView(_ view: ProbeView, coordinator: ()) {
        view.sink?.report(view.id, nil)
    }

    final class ProbeView: UIView {
        let id = UUID()
        var sink: OcclusionObstacleSink?

        override func layoutSubviews() {
            super.layoutSubviews()
            report()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            report()
        }

        func report() {
            guard let window else {
                sink?.report(id, nil)
                return
            }
            let frame = convert(bounds, to: window)
            let clearance = OcclusionLayout.barItemClearance
            sink?.report(id, frame.insetBy(dx: -clearance, dy: -clearance))
        }
    }
}

/// Finds the controls of the bars around the screen `readsOcclusionDisplay()` reads for: its
/// navigation bar, toolbar, and the floating bar iPhone Duo's outer display puts items in beside
/// the cameras. They're everything that's a `UIControl`, visible, and in the navigation
/// controller's view but outside the screen's own, in window coordinates (grown by
/// `OcclusionLayout.barItemClearance`). Only those in a camera column's strip beside a row change
/// anything (`OcclusionLayout.clearEdges`).
///
/// UIKit lays the bars out in its own pass, which tells SwiftUI nothing, so the scan runs when
/// the reader's probe lays out and when the display changes, and rows ask for it when their own
/// layout changes (`fullWidthClearOfOcclusions()`; not as they scroll): a bar that changes moves
/// the screen's content too.
@MainActor
final class OcclusionBarScanner {
    /// The reader's probe: the scan starts from its view controller.
    weak var view: UIView?
    /// Gets the controls' frames after each scan.
    var found: (([CGRect]) -> Void)?
    private var scheduled = false

    /// Scans now, and again once UIKit has laid out what this pass changed.
    func scheduleScan() {
        scan()
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.scheduled = false
            self?.scan()
        }
    }

    func scan() {
        guard let found, let view, let window = view.window else { return }
        var responder: UIResponder? = view
        while let next = responder, !(next is UIViewController) { responder = next.next }
        let screen = (responder as? UIViewController)?.view
        let root = (responder as? UIViewController)?.navigationController?.view ?? window
        var controls: [CGRect] = []
        func visit(_ candidate: UIView) {
            guard candidate !== screen, !candidate.isHidden, candidate.alpha > 0.01 else { return }
            if candidate is UIControl {
                let frame = candidate.convert(candidate.bounds, to: window)
                if frame.width > 0, frame.height > 0, window.bounds.intersects(frame) {
                    let clearance = OcclusionLayout.barItemClearance
                    controls.append(frame.insetBy(dx: -clearance, dy: -clearance))
                }
                return
            }
            candidate.subviews.forEach(visit)
        }
        visit(root)
        found(controls.sorted { ($0.minY, $0.minX) < ($1.minY, $1.minX) })
    }
}

/// The reader's view for `OcclusionBarScanner`: scans when it lays out, moves to a window, or the
/// display's bounds change.
private struct OcclusionBarScanProbe: UIViewRepresentable {
    let scanner: OcclusionBarScanner
    let bounds: CGRect?

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.scanner = scanner
        scanner.view = view
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        scanner.scheduleScan()
    }

    final class ProbeView: UIView {
        weak var scanner: OcclusionBarScanner?

        override func layoutSubviews() {
            super.layoutSubviews()
            scanner?.scheduleScan()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            scanner?.scheduleScan()
        }
    }
}

/// `fullWidthClearOfOcclusions()`.
struct OcclusionFullWidth: ViewModifier {
    @Environment(\.occlusionDisplay) private var display
    @Environment(\.occlusionScrollViewport) private var viewport
    @Environment(\.occlusionBarScanner) private var scanner
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
                        // Outside a scroll view, a row moves only when the layout changes, and a
                        // bar may have changed with it. Scrolling doesn't change the bars.
                        if viewport == nil { scanner?.scheduleScan() }
                        tracker.measured(next)
                        decide()
                    }
                }
                .onChange(of: display) {
                    tracker.displayChanged()
                    decide()
                }
                .onChange(of: viewport) { old, _ in
                    // The scroll view itself moved or resized: the layout changed.
                    scanner?.scheduleScan()
                    tracker.viewportChanged(from: old)
                    decide()
                }
        } else {
            content
        }
        #else
        content
        #endif
    }

    /// Applies the tracker's decision (`OcclusionTracker.decide`).
    private func decide() {
        guard let change = tracker.decide(current: open, display: display, viewport: viewport, layoutDirection: layoutDirection) else {
            return
        }
        if let animation = change.animation {
            withAnimation(animation) { open = change.edges }
        } else {
            OcclusionFullWidth.store { open = change.edges }
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
