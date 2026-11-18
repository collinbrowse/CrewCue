import SwiftUI

// Shared by the onboarding screens (runner setup, the race-day replay, its paywall).

extension View {
    /// Keeps the content's controls off a reserved region (the fold) that runs through it.
    func avoidsReservedRegions() -> some View {
        modifier(ReservedRegionInsets())
    }

    /// `avoidsReservedRegions()` only when `enabled`: a view the replay shares with a screen that
    /// keeps its own layout (the race Map tab's overlays).
    @ViewBuilder
    func avoidsReservedRegions(when enabled: Bool) -> some View {
        if enabled {
            avoidsReservedRegions()
        } else {
            self
        }
    }
}

/// Insets content away from any active division region (a fold) crossing it: the side of the
/// pane the region is on gets padded up to the region's far edge, margins included. Displays
/// without one, and systems before reserved regions, leave the content as it is. The insets are
/// read from the padded view's own frame, which the padding doesn't move, so they settle at once.
struct ReservedRegionInsets: ViewModifier {
    @State private var insets = EdgeInsets()

    @ViewBuilder
    func body(content: Content) -> some View {
        // Reserved regions ship in the iOS 27.1 SDK. CI still builds with Xcode 26 (Swift 6.2),
        // so they are compiled only by a Swift 6.4 (Xcode 27) toolchain; older toolchains leave
        // the content as it is. Drop the `#if` once CI's Xcode has that SDK.
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            content
                .padding(insets)
                .onGeometryChange(for: EdgeInsets.self) { proxy in
                    Self.insets(
                        for: proxy.reservedRegions(kind: .division).map { region in
                            // The region plus the clearance it asks for around it.
                            CGRect(
                                x: region.frame.minX - region.margins.leading,
                                y: region.frame.minY - region.margins.top,
                                width: region.frame.width + region.margins.leading + region.margins.trailing,
                                height: region.frame.height + region.margins.top + region.margins.bottom
                            )
                        },
                        width: proxy.size.width
                    )
                } action: { next in
                    insets = next
                }
        } else {
            content
        }
        #else
        content
        #endif
    }

    /// Leading or trailing padding for each region that crosses the content's width. A region
    /// left of the middle pushes the content past its trailing edge; one right of it stops the
    /// content before its leading edge.
    nonisolated static func insets(for regions: [CGRect], width: CGFloat) -> EdgeInsets {
        var insets = EdgeInsets()
        for frame in regions where frame.maxX > 0 && frame.minX < width && frame.height >= frame.width {
            if frame.midX < width / 2 {
                insets.leading = max(insets.leading, min(frame.maxX, width))
            } else {
                insets.trailing = max(insets.trailing, min(width - frame.minX, width))
            }
        }
        return insets
    }
}
