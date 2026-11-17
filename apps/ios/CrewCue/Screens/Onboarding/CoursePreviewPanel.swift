import CoreLocation
import SwiftUI
import CrewCueClientCore

/// The course the server read from the runner's file: the line on the map, the checkpoints, and
/// the elevation profile along the route line (an unpaid race has no `baselineTrack`).
struct CoursePreviewPanel: View {
    let preview: CoursePreview
    var summary: String?
    @Environment(\.crew) private var theme
    @ScaledMetric(relativeTo: .body) private var mapHeight: CGFloat = 220

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if MapCanvas.available {
                CoursePreviewMap(preview: preview)
                    .frame(maxWidth: .infinity, minHeight: mapHeight, maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
                    .accessibilityLabel(OnboardingCopy.coursePreviewLabel)
                    .accessibilityIdentifier("crewcue.onboarding.course-map")
            }
            if let summary {
                Text(summary)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                    .accessibilityIdentifier("crewcue.onboarding.course-summary")
            }
            if let elevation = preview.elevation {
                ElevationProfileView(profile: elevation)
                    .frame(height: 72)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(OnboardingCopy.elevationProfileLabel)
                    .accessibilityIdentifier("crewcue.onboarding.elevation-profile")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding.course-preview")
    }
}

private struct CoursePreviewMap: View {
    let preview: CoursePreview
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
            lineColor: UIColor(theme.primary),
            trackColor: UIColor(theme.secondary),
            route: preview.route.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) },
            fitPadding: UIEdgeInsets(top: 36, left: 36, bottom: 36, right: 36),
            refitOnResize: true
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
