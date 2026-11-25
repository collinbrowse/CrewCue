import CoreLocation
import SwiftUI
import CrewCueClientCore

/// Where the course preview goes in runner setup. While the picked file is read and previewed,
/// and until the preview's map has drawn its first full frame, the Cairn loader sits centred in
/// that space, and the map, summary and elevation profile stay hidden under it, so no blank tiles
/// or empty profile show first. It says "Reading your course…" only while a picked file is read;
/// a preview restored after a relaunch waits for its map under the loader alone. Reduce Motion
/// shows the loader's finished stack. A failed preview shows nothing here: the step offers Try
/// again.
struct CoursePreviewSlot: View {
    let preview: CoursePreview?
    var summary: String?
    /// The file is being read and previewed.
    var previewing: Bool
    /// A picked file is being read, from the pick until its map is ready (the caption shows).
    var reading: Bool
    var mapReady: Bool
    var onMapReady: () -> Void
    /// About the preview's own height (map, summary, profile), so it replaces the loader in place.
    @ScaledMetric(relativeTo: .body) private var placeholderHeight: CGFloat = 320

    /// The preview's map hasn't drawn yet. The wait has a limit, so a map that never reports a
    /// full frame (tiles that keep failing) still shows rather than a loader for good.
    private var waitingForMap: Bool { preview != nil && !mapReady && MapCanvas.available }
    private var loading: Bool { previewing || waitingForMap }

    var body: some View {
        ZStack {
            if let preview {
                // Laid out and drawing under the loader, so the map can load its tiles; hidden
                // from sight, touch and VoiceOver until then.
                CoursePreviewPanel(preview: preview, summary: summary, concealed: loading, onMapRendered: onMapReady)
                    .opacity(loading ? 0 : 1)
                    .allowsHitTesting(!loading)
            } else {
                Color.clear
                    .frame(maxWidth: .infinity, minHeight: placeholderHeight)
            }
            if loading {
                CourseLoading(reading: previewing || reading)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: loading)
        // Keyed on the preview itself: another file with the same name waits for its own map.
        .task(id: preview) {
            guard waitingForMap else { return }
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            onMapReady()
        }
    }
}

/// The loader in the course preview's place, captioned while a picked file is read.
private struct CourseLoading: View {
    let reading: Bool
    @Environment(\.colorScheme) private var scheme
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(spacing: CrewSpace.stackSm) {
            CairnLoader(onLight: scheme == .light)
                .frame(width: 64, height: 64)
            if reading {
                Text(OnboardingCopy.readingCourse)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(reading ? OnboardingCopy.readingCourse : OnboardingCopy.loading)
        .accessibilityIdentifier("crewcue.onboarding.course-loading")
    }
}

/// The course the server read from the runner's file: the line on the map, the checkpoints, and
/// the elevation profile along the route line (an unpaid race has no `baselineTrack`).
struct CoursePreviewPanel: View {
    let preview: CoursePreview
    var summary: String?
    /// Under the setup loader: kept out of VoiceOver (the map's own UIKit view included).
    var concealed = false
    /// The map drew a full frame (see `MapLibreCourseMap.onRendered`).
    var onMapRendered: () -> Void = {}
    @Environment(\.crew) private var theme
    @ScaledMetric(relativeTo: .body) private var mapHeight: CGFloat = 220

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if MapCanvas.available {
                CoursePreviewMap(preview: preview, onRendered: onMapRendered)
                    .frame(maxWidth: .infinity, minHeight: mapHeight, maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
                    // The race map's own info button (map licensing), not MapLibre's older sheet.
                    .overlay(alignment: .topTrailing) {
                        MapLicensingButton()
                            .padding(4)
                            .accessibilityHidden(concealed)
                    }
                    .accessibilityLabel(OnboardingCopy.coursePreviewLabel)
                    .accessibilityIdentifier("crewcue.onboarding.course-map")
                    .accessibilityHidden(concealed)
            }
            if let summary {
                Text(summary)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                    .accessibilityIdentifier("crewcue.onboarding.course-summary")
                    .accessibilityHidden(concealed)
            }
            if let elevation = preview.elevation {
                ElevationProfileView(profile: elevation)
                    .frame(height: 72)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(OnboardingCopy.elevationProfileLabel)
                    .accessibilityIdentifier("crewcue.onboarding.elevation-profile")
                    .accessibilityHidden(concealed)
            } else if preview.route.count >= 2 {
                // The line came back without elevation (a GPX with no <ele>): say so, rather
                // than a profile that never draws.
                Text(OnboardingCopy.courseNoElevation)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.no-elevation")
                    .accessibilityHidden(concealed)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding.course-preview")
        .accessibilityHidden(concealed)
    }
}

private struct CoursePreviewMap: View {
    let preview: CoursePreview
    var onRendered: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        #if canImport(MapLibre)
        MapLibreCourseMap(
            points: preview.checkpoints.map {
                MapCoursePoint(
                    id: $0.id,
                    title: ScheduleFormat.checkpointDisplayTitle(id: $0.id, title: $0.title),
                    latitude: $0.latitude,
                    longitude: $0.longitude
                )
            },
            onTap: { _, _ in },
            onStyleFailure: { _ in },
            onStyleLoaded: {},
            onRendered: onRendered,
            lineColor: UIColor(theme.secondary),
            trackColor: UIColor(theme.primary),
            route: preview.route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) },
            fitPadding: UIEdgeInsets(top: 36, left: 36, bottom: 36, right: 36),
            refitOnResize: true,
            shrinksPaddingToFit: true,
            // Terrain-style tiles at every appearance, never the black night map.
            baseStyle: .streets,
            hidesAttributionButton: true
        )
        #else
        EmptyView()
        #endif
    }
}

/// Elevation along the course, as a filled line.
struct ElevationProfileView: View {
    let profile: ElevationProfile
    @Environment(\.crew) private var theme

    var body: some View {
        GeometryReader { proxy in
            let line = path(in: proxy.size, closed: false)
            ZStack {
                path(in: proxy.size, closed: true)
                    .fill(theme.primary.opacity(0.18))
                line.stroke(theme.primary, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
            }
        }
    }

    private func path(in size: CGSize, closed: Bool) -> Path {
        let samples = profile.samples
        guard let first = samples.first, let last = samples.last, last.distanceMeters > first.distanceMeters else { return Path() }
        let low = samples.map(\.elevationMeters).min() ?? 0
        let high = samples.map(\.elevationMeters).max() ?? 0
        let span = max(high - low, 1)
        let run = last.distanceMeters - first.distanceMeters
        func point(_ sample: (distanceMeters: Double, elevationMeters: Double)) -> CGPoint {
            CGPoint(
                x: size.width * (sample.distanceMeters - first.distanceMeters) / run,
                y: size.height * (1 - (sample.elevationMeters - low) / span) * 0.9 + size.height * 0.05
            )
        }
        var path = Path()
        path.move(to: point(first))
        for sample in samples.dropFirst() { path.addLine(to: point(sample)) }
        if closed {
            path.addLine(to: CGPoint(x: size.width, y: size.height))
            path.addLine(to: CGPoint(x: 0, y: size.height))
            path.closeSubpath()
        }
        return path
    }
}
