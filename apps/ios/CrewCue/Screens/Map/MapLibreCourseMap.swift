import CoreLocation
import SwiftUI
import UIKit

#if canImport(MapLibre)
import MapLibre

struct MapLibreCourseMap: UIViewRepresentable {
    var points: [MapCoursePoint]
    /// The runner's path from the API, oldest first. Drawn over the course; the last point is the runner.
    var track: [CLLocationCoordinate2D] = []
    /// When each `track` point was recorded. Only the onboarding replay's gliding dot reads them.
    var trackTimes: [Date] = []
    /// The onboarding replay's dot between updates, sampled every frame while it plays: the dot
    /// sits there and the trail stops at it. Nil on the race map and under Reduce Motion: the dot
    /// sits on the latest point.
    var glideFrame: RunnerGlideFrame?
    var onTap: (Double, Double) -> Void
    var onStyleFailure: (Bool) -> Void
    var onStyleLoaded: () -> Void
    var recenterRequest = 0
    var lineColor = UIColor(red: 0.329, green: 0.251, blue: 0.725, alpha: 1)
    var trackColor = UIColor.systemOrange
    /// The course line from the server's GPX read (setup preview). Empty: the line joins the checkpoints.
    var route: [CLLocationCoordinate2D] = []
    /// Room kept clear when the course is framed. The race map leaves space for its chips and sheet.
    var fitPadding = MapLibreCourseMap.raceFitPadding
    static let raceFitPadding = UIEdgeInsets(top: 210, left: 48, bottom: 380, right: 90)
    /// The onboarding replay's map: a shorter pane under the replay's caption, with the same aid
    /// sheet and chips but no top bar. The course sits above the sheet, clear of the first chip
    /// row and of the chip column on the right.
    static let replayFitPadding = UIEdgeInsets(top: 60, left: 40, bottom: 340, right: 90)
    /// Frame the course again whenever the map changes size (a small preview laid out late, or a
    /// fold). The race map keeps the camera where the person panned it, so it leaves this off.
    var refitOnResize = false
    /// A map in a pane (the onboarding replay, the setup course preview): `fitPadding` shrinks
    /// when it would leave the course under a quarter of the map. The race map leaves this off
    /// and always frames with its full padding, clear of its chips and sheet.
    var shrinksPaddingToFit = false

    /// OpenFreeMap: free, keyless vector tiles (OpenStreetMap data). The style's TileJSON carries the
    /// OpenFreeMap / OpenMapTiles / OpenStreetMap attribution shown by the map's attribution button.
    static func styleURL(dark: Bool) -> URL? {
        URL(string: "https://tiles.openfreemap.org/styles/\(dark ? "dark" : "liberty")")
    }

    /// A local style with only a background layer. Loaded when the tile server is unreachable so the
    /// course line and checkpoints still draw on a blank background.
    static func blankStyleURL(dark: Bool) -> URL? {
        let color = dark ? "#1c1c1e" : "#f2efe9"
        let json = #"{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"\#(color)"}}]}"#
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("crewcue-blank-style-\(dark ? "dark" : "light").json")
        do {
            try Data(json.utf8).write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTap: onTap, onStyleFailure: onStyleFailure, onStyleLoaded: onStyleLoaded)
    }

    func makeUIView(context: Context) -> MLNMapView {
        let dark = context.environment.colorScheme == .dark
        let mapView = ResizingMapView(frame: .zero, styleURL: Self.styleURL(dark: dark))
        if refitOnResize {
            let coordinator = context.coordinator
            mapView.onResize = { [weak coordinator] in coordinator?.fitCourse(animated: false) }
        }
        context.coordinator.dark = dark
        mapView.delegate = context.coordinator
        mapView.tintColor = lineColor
        mapView.logoView.isHidden = true
        // Keep OpenFreeMap/OSM attribution reachable: below the top bar and status chips.
        mapView.attributionButtonPosition = .topLeft
        mapView.attributionButtonMargins = CGPoint(x: 16, y: 150)
        mapView.compassViewPosition = .topLeft
        mapView.compassViewMargins = CGPoint(x: 16, y: 190)
        context.coordinator.mapView = mapView
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleMapTap(sender:)))
        tap.name = "crewcue.checkpoint-tap"
        tap.cancelsTouchesInView = false
        mapView.addGestureRecognizer(tap)
        return mapView
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {
        context.coordinator.onTap = onTap
        context.coordinator.onStyleFailure = onStyleFailure
        context.coordinator.onStyleLoaded = onStyleLoaded
        context.coordinator.points = points
        context.coordinator.track = track
        context.coordinator.trackTimes = trackTimes
        context.coordinator.glideFrame = glideFrame
        context.coordinator.lineColor = lineColor
        context.coordinator.trackColor = trackColor
        context.coordinator.route = route
        context.coordinator.fitPadding = fitPadding
        context.coordinator.shrinksPaddingToFit = shrinksPaddingToFit
        let dark = context.environment.colorScheme == .dark
        if context.coordinator.dark != dark {
            context.coordinator.dark = dark
            context.coordinator.usingBlankStyle = false
            mapView.styleURL = Self.styleURL(dark: dark)
        }
        context.coordinator.redraw(force: false)
        context.coordinator.redrawTrack(force: false)
        if context.coordinator.recenterRequest != recenterRequest {
            context.coordinator.recenterRequest = recenterRequest
            context.coordinator.fitCourse(animated: true)
        }
    }

    nonisolated static func isOffline(_ error: Error) -> Bool {
        if APIFailure.isTransport(error) {
            return true
        }
        let nsError = error as NSError
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? Error, APIFailure.isTransport(underlying) {
            return true
        }
        return false
    }

    @MainActor
    final class Coordinator: NSObject, MLNMapViewDelegate {
        var points: [MapCoursePoint] = []
        var onTap: (Double, Double) -> Void
        var onStyleFailure: (Bool) -> Void
        var onStyleLoaded: () -> Void
        weak var mapView: MLNMapView?
        var recenterRequest = 0
        var dark = false
        /// True after the remote style failed and the blank local style replaced it.
        var usingBlankStyle = false
        var lineColor = UIColor.systemPurple
        var trackColor = UIColor.systemOrange
        var track: [CLLocationCoordinate2D] = []
        var trackTimes: [Date] = []
        var glideFrame: RunnerGlideFrame?
        var route: [CLLocationCoordinate2D] = []
        var fitPadding = UIEdgeInsets(top: 210, left: 48, bottom: 380, right: 90)
        var shrinksPaddingToFit = false
        private var drawnPoints: [MapCoursePoint] = []
        private var drawnRoute: [CLLocationCoordinate2D] = []
        private var drawnTrack: [CLLocationCoordinate2D] = []
        private var trackAnnotations: [MLNAnnotation] = []
        /// The gliding dot as last drawn, and the two shapes a frame moves without a redraw.
        private var drawnGlide: GlideLayout?
        private var glidePath: RunnerPathPolyline?
        private var glideMarker: RunnerMarker?

        init(
            onTap: @escaping (Double, Double) -> Void,
            onStyleFailure: @escaping (Bool) -> Void,
            onStyleLoaded: @escaping () -> Void
        ) {
            self.onTap = onTap
            self.onStyleFailure = onStyleFailure
            self.onStyleLoaded = onStyleLoaded
        }

        func redraw(force: Bool) {
            guard let mapView, mapView.style != nil else { return }
            if !force, points == drawnPoints, Self.same(route, drawnRoute) { return }
            if let existing = mapView.annotations {
                mapView.removeAnnotations(existing.filter { !($0 is RunnerPathPolyline) && !($0 is RunnerMarker) })
            }
            var annotations: [MLNAnnotation] = []
            if route.count >= 2 {
                var coordinates = route
                annotations.append(MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count)))
            } else if points.count >= 2 {
                var coordinates = points.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
                let polyline = MLNPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
                annotations.append(polyline)
            }
            for point in points {
                let marker = MLNPointAnnotation()
                marker.coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
                marker.title = point.title
                annotations.append(marker)
            }
            if annotations.isEmpty == false {
                mapView.addAnnotations(annotations)
                fitCourse(animated: false)
            }
            drawnPoints = points
            drawnRoute = route
        }

        /// Replaces the runner's path and position marker. Never moves the camera: a 30-second
        /// refresh must not pull the map away from where the crew member panned it.
        func redrawTrack(force: Bool) {
            guard let mapView, mapView.style != nil else { return }
            if let glideFrame, !track.isEmpty, trackTimes.count == track.count {
                redrawGlide(GlideLayout(frame: glideFrame, track: track, times: trackTimes), force: force)
                return
            }
            if !force, drawnGlide == nil, Self.same(track, drawnTrack) { return }
            clearGlide()
            mapView.removeAnnotations(trackAnnotations)
            var next: [MLNAnnotation] = []
            if track.count >= 2 {
                var coordinates = track
                next.append(RunnerPathPolyline(coordinates: &coordinates, count: UInt(coordinates.count)))
            }
            if let last = track.last {
                let marker = RunnerMarker()
                marker.coordinate = last
                marker.title = "Runner"
                next.append(marker)
            }
            mapView.addAnnotations(next)
            trackAnnotations = next
            drawnTrack = track
        }

        /// The onboarding replay, frame by frame: the path behind the dot, and the dot on the
        /// course where the glide has it. The path up to where the glide began stays one shape
        /// until the next update; a frame only moves the short stretch since then and the dot.
        private func redrawGlide(_ layout: GlideLayout, force: Bool) {
            guard let mapView else { return }
            if !force, let drawn = drawnGlide, drawn.settled == layout.settled, let glidePath, let glideMarker,
               Self.same(track, drawnTrack) {
                guard drawn != layout else { return }
                var stretch = layout.stretch(of: track)
                glidePath.setCoordinates(&stretch, count: UInt(stretch.count))
                glideMarker.coordinate = layout.dot
                drawnGlide = layout
                return
            }
            mapView.removeAnnotations(trackAnnotations)
            var next: [MLNAnnotation] = []
            if layout.settled >= 2 {
                var settled = Array(track[..<layout.settled])
                next.append(RunnerPathPolyline(coordinates: &settled, count: UInt(settled.count)))
            }
            var stretch = layout.stretch(of: track)
            let path = RunnerPathPolyline(coordinates: &stretch, count: UInt(stretch.count))
            next.append(path)
            let marker = RunnerMarker()
            marker.coordinate = layout.dot
            marker.title = "Runner"
            next.append(marker)
            mapView.addAnnotations(next)
            trackAnnotations = next
            drawnTrack = track
            drawnGlide = layout
            glidePath = path
            glideMarker = marker
        }

        private func clearGlide() {
            drawnGlide = nil
            glidePath = nil
            glideMarker = nil
        }

        private static func same(_ a: [CLLocationCoordinate2D], _ b: [CLLocationCoordinate2D]) -> Bool {
            a.count == b.count && zip(a, b).allSatisfy { $0.latitude == $1.latitude && $0.longitude == $1.longitude }
        }

        /// Frames the course above the bottom sheet and below the top chips.
        func fitCourse(animated: Bool) {
            guard let mapView, let all = mapView.annotations else { return }
            let annotations = all.filter { !($0 is RunnerPathPolyline) && !($0 is RunnerMarker) }
            guard annotations.isEmpty == false else { return }
            let padding = shrinksPaddingToFit ? Self.padding(fitPadding, in: mapView.bounds.size) : fitPadding
            mapView.showAnnotations(annotations, edgePadding: padding, animated: animated, completionHandler: nil)
        }

        /// `padding`, shrunk evenly when it would leave the course less than a quarter of the map
        /// (a map in a short pane), where the camera could only zoom out to the whole world. A
        /// tall enough pane keeps its padding as it is. Only maps that set `shrinksPaddingToFit`.
        nonisolated static func padding(_ padding: UIEdgeInsets, in size: CGSize) -> UIEdgeInsets {
            func fit(_ lead: CGFloat, _ trail: CGFloat, _ length: CGFloat) -> (CGFloat, CGFloat) {
                let room = max(0, length) * 0.75
                guard lead + trail > room, lead + trail > 0 else { return (lead, trail) }
                let scale = room / (lead + trail)
                return (lead * scale, trail * scale)
            }
            let (top, bottom) = fit(padding.top, padding.bottom, size.height)
            let (left, right) = fit(padding.left, padding.right, size.width)
            return UIEdgeInsets(top: top, left: left, bottom: bottom, right: right)
        }

        nonisolated func mapView(_ mapView: MLNMapView, strokeColorForShapeAnnotation annotation: MLNShape) -> UIColor {
            let isTrack = annotation is RunnerPathPolyline
            return MainActor.assumeIsolated { isTrack ? self.trackColor : self.lineColor }
        }

        nonisolated func mapView(_ mapView: MLNMapView, lineWidthForPolylineAnnotation annotation: MLNPolyline) -> CGFloat {
            annotation is RunnerPathPolyline ? 4 : 5
        }

        nonisolated func mapView(_ mapView: MLNMapView, alphaForShapeAnnotation annotation: MLNShape) -> CGFloat {
            0.95
        }

        nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            MainActor.assumeIsolated {
                // The blank fallback keeps the failure message up; only the real style counts as loaded.
                if !self.usingBlankStyle {
                    self.onStyleLoaded()
                }
                self.drawnPoints = []
                self.redraw(force: true)
                self.redrawTrack(force: true)
            }
        }

        nonisolated func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
            let offline = MapLibreCourseMap.isOffline(error)
            MainActor.assumeIsolated {
                self.onStyleFailure(offline)
                guard !self.usingBlankStyle, let blank = MapLibreCourseMap.blankStyleURL(dark: self.dark) else { return }
                self.usingBlankStyle = true
                mapView.styleURL = blank
            }
        }

        nonisolated func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            if annotation is RunnerMarker {
                return MainActor.assumeIsolated { self.runnerView() }
            }
            guard let point = annotation as? MLNPointAnnotation else { return nil }
            let title = point.title ?? ""
            return MainActor.assumeIsolated {
                self.checkpointView(title: title)
            }
        }

        private func runnerView() -> RunnerMarkerView {
            let reuse = "crewcue-runner"
            let view = mapView?.dequeueReusableAnnotationView(withIdentifier: reuse) as? RunnerMarkerView
                ?? RunnerMarkerView(reuseIdentifier: reuse)
            view.color = trackColor
            return view
        }

        private func checkpointView(title: String) -> CheckpointTitleView {
            let reuse = "crewcue-checkpoint"
            let view = mapView?.dequeueReusableAnnotationView(withIdentifier: reuse) as? CheckpointTitleView
                ?? CheckpointTitleView(reuseIdentifier: reuse)
            view.setTitle(title)
            return view
        }

        @objc func handleMapTap(sender: UITapGestureRecognizer) {
            guard let mapView else { return }
            let coordinate = mapView.convert(sender.location(in: mapView), toCoordinateFrom: nil)
            onTap(coordinate.latitude, coordinate.longitude)
        }
    }
}

/// Where the gliding dot is on the runner's path: `settled` points were behind it when its glide
/// began, `reached` are behind it now, and `dot` is the dot. A path read that hasn't caught up
/// with the glide yet keeps the dot on the path's last point.
struct GlideLayout: Equatable {
    var settled: Int
    var reached: Int
    var latitude: Double
    var longitude: Double

    var dot: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }

    init(frame: RunnerGlideFrame, track: [CLLocationCoordinate2D], times: [Date]) {
        settled = Self.count(times, atOrBefore: frame.from)
        let caughtUp = (times.last ?? .distantPast) >= frame.at
        reached = caughtUp ? Self.count(times, atOrBefore: frame.at) : times.count
        let dot = caughtUp ? frame.coordinate : (track.last ?? frame.coordinate)
        latitude = dot.latitude
        longitude = dot.longitude
    }

    /// The path from the last settled point through the points reached since, to the dot. At
    /// least two points, so the shape always draws.
    func stretch(of track: [CLLocationCoordinate2D]) -> [CLLocationCoordinate2D] {
        let start = max(0, min(settled, reached) - 1)
        var points = Array(track[start..<min(reached, track.count)])
        points.append(dot)
        if points.count < 2 {
            points.append(dot)
        }
        return points
    }

    /// How many of `times` (oldest first) are at or before `moment`.
    static func count(_ times: [Date], atOrBefore moment: Date) -> Int {
        var low = 0
        var high = times.count
        while low < high {
            let middle = (low + high) / 2
            if times[middle] <= moment { low = middle + 1 } else { high = middle }
        }
        return low
    }
}

/// Reports size changes after layout, so a course can be framed in the map's real bounds.
final class ResizingMapView: MLNMapView {
    var onResize: (() -> Void)?
    private var laidOutSize: CGSize = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != laidOutSize, bounds.width > 0, bounds.height > 0 else { return }
        laidOutSize = bounds.size
        onResize?()
    }
}

/// The runner's path, told apart from the course line for color and width.
final class RunnerPathPolyline: MLNPolyline {}

/// The runner's latest accepted position.
final class RunnerMarker: MLNPointAnnotation {}

final class RunnerMarkerView: MLNAnnotationView {
    var color = UIColor.systemOrange {
        didSet { backgroundColor = color }
    }

    override init(reuseIdentifier: String?) {
        super.init(reuseIdentifier: reuseIdentifier)
        bounds = CGRect(x: 0, y: 0, width: 22, height: 22)
        layer.cornerRadius = 11
        layer.borderColor = UIColor.white.cgColor
        layer.borderWidth = 3
        backgroundColor = color
        isAccessibilityElement = true
        accessibilityLabel = "Runner position"
        accessibilityIdentifier = "crewcue.runner-track.marker"
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

final class CheckpointTitleView: MLNAnnotationView {
    private let label = UILabel()

    override init(reuseIdentifier: String?) {
        super.init(reuseIdentifier: reuseIdentifier)
        backgroundColor = UIColor.white.withAlphaComponent(0.94)
        layer.borderColor = UIColor(red: 0.329, green: 0.251, blue: 0.725, alpha: 1).cgColor
        layer.borderWidth = 1.5
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.12
        layer.shadowRadius = 6
        layer.shadowOffset = CGSize(width: 0, height: 2)
        label.font = Self.font
        label.adjustsFontForContentSizeCategory = true
        label.textColor = UIColor(red: 0.110, green: 0.110, blue: 0.090, alpha: 1)
        label.textAlignment = .center
        addSubview(label)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setTitle(_ title: String) {
        label.text = title
        label.font = Self.font
        label.sizeToFit()
        let width = max(44, label.bounds.width + 20)
        let height = max(26, label.bounds.height + 10)
        bounds = CGRect(x: 0, y: 0, width: width, height: height)
        layer.cornerRadius = height / 2
        label.frame = bounds
    }

    private static var font: UIFont {
        UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 12, weight: .bold))
    }
}
#endif
