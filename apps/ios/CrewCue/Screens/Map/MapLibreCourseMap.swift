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
    /// A frame drawn with every tile it needs, on a loaded style (the remote one or the blank
    /// fallback). Fires again after camera moves; the setup course preview waits for the first.
    var onRendered: () -> Void = {}
    var recenterRequest = 0
    var lineColor = UIColor(red: 0.204, green: 0.251, blue: 0.310, alpha: 1)
    var trackColor = UIColor(red: 0.710, green: 0.267, blue: 0.102, alpha: 1)
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
    /// A map in a pane (the onboarding replay, the setup course preview): it frames every new
    /// course it is given. The race map leaves this off and frames its course once. Every map's
    /// `fitPadding` shrinks when it would leave the course under a quarter of the map.
    var shrinksPaddingToFit = false
    /// The base layer the person chose. The setup preview and the replay keep `.automatic`.
    var baseStyle = MapBaseStyle.automatic
    /// Placing a checkpoint: the spot under `pickAnchor` (a point in window coordinates, where the
    /// crosshair sits) is reported through `onPickCenter` each time the map settles. A tap moves
    /// the tapped spot under the crosshair.
    var pickAnchor: CGPoint?
    var onPickCenter: ((Double, Double) -> Void)?
    /// A typed position: the map moves it under the crosshair.
    var pickTarget: PickTarget?
    /// The position the field holds now. When the crosshair moves (the sheet changed height, the
    /// keyboard came up) the map keeps this spot under it, rather than rewriting the field.
    var pickCoordinate: CLLocationCoordinate2D?
    /// The runner's latest ping. The dot sits here until the runner has a path (a test ping
    /// before the start has none). Bumping `runnerFocusRequest` zooms the camera to it, centered
    /// on `focusAnchor` (window coordinates: the middle of the map between the bar and the sheet).
    var runnerCoordinate: CLLocationCoordinate2D?
    var runnerFocusRequest = 0
    var focusAnchor: CGPoint?
    /// Where the course starts. Bumping `startLineRequest` zooms the camera in on it, centered on
    /// `focusAnchor` (the runner tour's start-line step).
    var startLine: CLLocationCoordinate2D?
    var startLineRequest = 0

    /// OpenFreeMap: free, keyless vector tiles (OpenStreetMap data). The style's TileJSON carries the
    /// OpenFreeMap / OpenMapTiles / OpenStreetMap attribution shown by the map's attribution button.
    static func styleURL(dark: Bool) -> URL? {
        styleURL(MapBaseStyle.automatic, dark: dark)
    }

    static func styleURL(_ style: MapBaseStyle, dark: Bool) -> URL? {
        URL(string: "https://tiles.openfreemap.org/styles/\(style.styleName(dark: dark))")
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
        let coordinator = Coordinator(onTap: onTap, onStyleFailure: onStyleFailure, onStyleLoaded: onStyleLoaded)
        coordinator.onRendered = onRendered
        return coordinator
    }

    func makeUIView(context: Context) -> MLNMapView {
        let dark = context.environment.colorScheme == .dark
        let mapView = ResizingMapView(frame: .zero, styleURL: Self.styleURL(baseStyle, dark: dark))
        context.coordinator.styleKey = baseStyle.styleName(dark: dark)
        if refitOnResize {
            let coordinator = context.coordinator
            mapView.onResize = { [weak coordinator] in coordinator?.fitCourse(animated: false) }
        }
        context.coordinator.dark = baseStyle.isDark(dark: dark)
        mapView.delegate = context.coordinator
        mapView.tintColor = lineColor
        mapView.logoView.isHidden = true
        // The race map draws its own info button (map licensing) under its top bar. A map
        // without one (setup preview, replay) keeps MapLibre's own button.
        mapView.attributionButtonPosition = .topLeft
        mapView.attributionButtonMargins = CGPoint(x: 16, y: 150)
        mapView.attributionButton.isHidden = hidesAttributionButton
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
        context.coordinator.onRendered = onRendered
        context.coordinator.points = points
        context.coordinator.track = track
        context.coordinator.trackTimes = trackTimes
        context.coordinator.glideFrame = glideFrame
        context.coordinator.lineColor = lineColor
        context.coordinator.trackColor = trackColor
        context.coordinator.route = route
        context.coordinator.fitPadding = fitPadding
        context.coordinator.shrinksPaddingToFit = shrinksPaddingToFit
        context.coordinator.onPickCenter = onPickCenter
        context.coordinator.followsRunner = followsRunner
        let dark = context.environment.colorScheme == .dark
        let key = baseStyle.styleName(dark: dark)
        if context.coordinator.styleKey != key {
            context.coordinator.styleKey = key
            context.coordinator.dark = baseStyle.isDark(dark: dark)
            context.coordinator.usingBlankStyle = false
            mapView.styleURL = Self.styleURL(baseStyle, dark: dark)
        }
        context.coordinator.redraw(force: false)
        context.coordinator.latestPing = runnerCoordinate
        context.coordinator.redrawTrack(force: false)
        if context.coordinator.recenterRequest != recenterRequest {
            context.coordinator.recenterRequest = recenterRequest
            context.coordinator.fitCourse(animated: true)
        }
        context.coordinator.updatePick(anchor: pickAnchor, target: pickTarget, holding: pickCoordinate)
        if context.coordinator.startLineRequest != startLineRequest {
            context.coordinator.startLineRequest = startLineRequest
            if let startLine {
                context.coordinator.zoomToStart(startLine, anchor: focusAnchor)
            }
        }
        if context.coordinator.runnerFocusRequest != runnerFocusRequest {
            context.coordinator.runnerFocusRequest = runnerFocusRequest
            if let runnerCoordinate {
                context.coordinator.focus(on: runnerCoordinate, anchor: focusAnchor)
            }
        }
    }

    /// The race map draws its own info button (under the top bar), so MapLibre's is hidden.
    var hidesAttributionButton = false
    /// The onboarding replay: the camera zooms onto the runner's dot and keeps it in view, so the
    /// person sees it move instead of a whole-course view where aid station names cover it.
    var followsRunner = false

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
        var onRendered: () -> Void = {}
        weak var mapView: MLNMapView?
        var recenterRequest = 0
        var runnerFocusRequest = 0
        var startLineRequest = 0
        /// The runner's latest ping: the dot when there is no path yet.
        var latestPing: CLLocationCoordinate2D?
        private var drawnDot: CLLocationCoordinate2D?
        /// The OpenFreeMap style name on the map now.
        var styleKey = ""
        var onPickCenter: ((Double, Double) -> Void)?
        /// Where the crosshair sits (window coordinates) while placing a checkpoint.
        private var pickAnchor: CGPoint?
        private var pickTargetId: Int?
        var dark = false
        /// True after the remote style failed and the blank local style replaced it.
        var usingBlankStyle = false
        var lineColor = UIColor(red: 0.204, green: 0.251, blue: 0.310, alpha: 1)
        var trackColor = UIColor(red: 0.710, green: 0.267, blue: 0.102, alpha: 1)
        var track: [CLLocationCoordinate2D] = []
        var trackTimes: [Date] = []
        var glideFrame: RunnerGlideFrame?
        var route: [CLLocationCoordinate2D] = []
        var fitPadding = UIEdgeInsets(top: 210, left: 48, bottom: 380, right: 90)
        var shrinksPaddingToFit = false
        var followsRunner = false
        private var drawnPoints: [MapCoursePoint] = []
        /// The course has been framed on this map.
        private var framedCourse = false
        private var drawnRoute: [CLLocationCoordinate2D] = []
        private var drawnTrack: [CLLocationCoordinate2D] = []
        /// The runner's path as drawn: one shape, or in the replay's glide the path up to where
        /// the glide began and the stretch since.
        private var pathShapes: [RunnerPathPolyline] = []
        /// The runner's dot. It stays on the map from update to update and only moves, so its
        /// view is never torn down and dequeued again (no frame without a dot).
        private var runnerMarker: RunnerMarker?
        /// The gliding dot as last drawn, and the stretch of path a frame moves without a redraw.
        private var drawnGlide: GlideLayout?
        private var glidePath: RunnerPathPolyline?

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
            if !force, points == drawnPoints, Self.same(route, drawnRoute) {
                // Keep the caller's arrays: the next frame passes the same ones, and checks them
                // by their storage alone.
                drawnPoints = points
                drawnRoute = route
                return
            }
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
                // Framed once. A course that changes later (a checkpoint placed, the base map
                // switched) keeps the camera where the person has it; Fit course frames again.
                // Maps in a pane (setup preview, replay) frame every new course.
                if !framedCourse || shrinksPaddingToFit {
                    framedCourse = true
                    fitCourse(animated: false)
                }
            }
            drawnPoints = points
            drawnRoute = route
        }

        /// Replaces the runner's path and moves the dot onto its latest point. Never moves the camera: a 30-second
        /// refresh must not pull the map away from where the crew member panned it.
        func redrawTrack(force: Bool) {
            guard let mapView, mapView.style != nil else { return }
            if force {
                // A new style: every shape and the dot again.
                clearTrack(on: mapView)
            }
            if let glideFrame, !track.isEmpty, trackTimes.count == track.count {
                redrawGlide(GlideLayout(frame: glideFrame, track: track, times: trackTimes), on: mapView)
                return
            }
            let dot = track.last ?? latestPing
            if drawnGlide == nil, Self.same(track, drawnTrack) {
                drawnTrack = track
                if !force, Self.same(dot.map { [$0] } ?? [], drawnDot.map { [$0] } ?? []) { return }
                placeRunner(at: dot, on: mapView)
                drawnDot = dot
                return
            }
            drawnGlide = nil
            glidePath = nil
            replacePath(with: track.count >= 2 ? [track] : [], on: mapView)
            placeRunner(at: dot, on: mapView)
            drawnTrack = track
            drawnDot = dot
        }

        /// Zooms to `coordinate` (at least street level) with it at `anchor`, a window point.
        func focus(on coordinate: CLLocationCoordinate2D, anchor: CGPoint?, minimumZoom: Double = 14) {
            guard let mapView, CLLocationCoordinate2DIsValid(coordinate) else { return }
            let size = mapView.bounds.size
            var padding = UIEdgeInsets.zero
            if let anchor, mapView.window != nil {
                // Padding moves the center of the padded box onto the anchor.
                let point = mapView.convert(anchor, from: nil)
                let dy = size.height - 2 * point.y
                if dy > 0 { padding.bottom = dy } else { padding.top = -dy }
                let dx = size.width - 2 * point.x
                if dx > 0 { padding.right = dx } else { padding.left = -dx }
            }
            let zoom = max(mapView.zoomLevel, minimumZoom)
            let altitude = MLNAltitudeForZoomLevel(zoom, 0, coordinate.latitude, size)
            let camera = MLNMapCamera(lookingAtCenter: coordinate, altitude: altitude, pitch: 0, heading: mapView.direction)
            mapView.setCamera(camera, withDuration: 0.6, animationTimingFunction: CAMediaTimingFunction(name: .easeInEaseOut), edgePadding: padding, completionHandler: nil)
        }

        /// The onboarding replay, frame by frame: the path behind the dot, and the dot on the
        /// course where the glide has it. The path up to where the glide began stays one shape
        /// until the next update; a frame only moves the short stretch since then and the dot.
        private func redrawGlide(_ layout: GlideLayout, on mapView: MLNMapView) {
            if let drawn = drawnGlide, drawn.settled == layout.settled, let glidePath, Self.same(track, drawnTrack) {
                drawnTrack = track
                guard drawn != layout else { return }
                var stretch = layout.stretch(of: track)
                glidePath.setCoordinates(&stretch, count: UInt(stretch.count))
                placeRunner(at: layout.dot, on: mapView)
                drawnGlide = layout
                return
            }
            // A new update (or a new path): the two path shapes again. The dot only moves.
            var lines: [[CLLocationCoordinate2D]] = []
            if layout.settled >= 2 {
                lines.append(Array(track[..<layout.settled]))
            }
            lines.append(layout.stretch(of: track))
            glidePath = replacePath(with: lines, on: mapView).last
            placeRunner(at: layout.dot, on: mapView)
            drawnTrack = track
            drawnGlide = layout
        }

        /// Swaps the runner's path shapes for `lines`, and answers the new shapes.
        @discardableResult
        private func replacePath(with lines: [[CLLocationCoordinate2D]], on mapView: MLNMapView) -> [RunnerPathPolyline] {
            if !pathShapes.isEmpty {
                mapView.removeAnnotations(pathShapes)
            }
            pathShapes = lines.map { line in
                var coordinates = line
                return RunnerPathPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
            }
            if !pathShapes.isEmpty {
                mapView.addAnnotations(pathShapes)
            }
            return pathShapes
        }

        /// Moves the runner's dot to `coordinate`, adding it the first time. Nil: no dot.
        private func placeRunner(at coordinate: CLLocationCoordinate2D?, on mapView: MLNMapView) {
            guard let coordinate else {
                if let runnerMarker {
                    mapView.removeAnnotation(runnerMarker)
                }
                runnerMarker = nil
                return
            }
            defer { if followsRunner { follow(coordinate, on: mapView) } }
            if let runnerMarker {
                if runnerMarker.coordinate.latitude != coordinate.latitude || runnerMarker.coordinate.longitude != coordinate.longitude {
                    runnerMarker.coordinate = coordinate
                }
                return
            }
            let marker = RunnerMarker()
            marker.coordinate = coordinate
            marker.title = "Runner"
            mapView.addAnnotation(marker)
            runnerMarker = marker
        }

        /// The zoom the replay holds on the runner: close enough that the dot visibly moves along
        /// the line, with the nearest aid station's name off to one side rather than on top of it.
        static let followZoom = 14.5

        /// Keeps the replay's dot in view: zoomed onto it the first time, then recentered only when
        /// it drifts toward the edge, so the camera isn't moved on every one of the frames.
        private func follow(_ coordinate: CLLocationCoordinate2D, on mapView: MLNMapView) {
            let size = mapView.bounds.size
            guard CLLocationCoordinate2DIsValid(coordinate), size.width > 0, size.height > 0 else { return }
            // The open part of the pane: above the aid sheet, below the chips.
            let padding = Self.padding(fitPadding, in: size)
            let open = CGRect(x: padding.left, y: padding.top, width: max(1, size.width - padding.left - padding.right), height: max(1, size.height - padding.top - padding.bottom))
            let point = mapView.convert(coordinate, toPointTo: mapView)
            let drift = max(abs(point.x - open.midX) / open.width, abs(point.y - open.midY) / open.height)
            let zoomedIn = mapView.zoomLevel >= Self.followZoom - 0.5
            guard !zoomedIn || drift > 0.3 else { return }
            let zoom = max(mapView.zoomLevel, Self.followZoom)
            let altitude = MLNAltitudeForZoomLevel(zoom, 0, coordinate.latitude, size)
            let camera = MLNMapCamera(lookingAtCenter: coordinate, altitude: altitude, pitch: 0, heading: mapView.direction)
            mapView.setCamera(camera, withDuration: 0.5, animationTimingFunction: CAMediaTimingFunction(name: .easeInEaseOut), edgePadding: padding, completionHandler: nil)
        }

        private func clearTrack(on mapView: MLNMapView) {
            replacePath(with: [], on: mapView)
            placeRunner(at: nil, on: mapView)
            drawnTrack = []
            drawnGlide = nil
            glidePath = nil
        }

        /// `a` and `b` hold the same coordinates. Between two updates every replay frame passes
        /// the same arrays again, so their shared storage answers at once, without reading up to
        /// thousands of points 120 times a second.
        private static func same(_ a: [CLLocationCoordinate2D], _ b: [CLLocationCoordinate2D]) -> Bool {
            guard a.count == b.count else { return false }
            let shared = a.withUnsafeBufferPointer { left in
                b.withUnsafeBufferPointer { right in left.baseAddress == right.baseAddress }
            }
            return shared || zip(a, b).allSatisfy { $0.latitude == $1.latitude && $0.longitude == $1.longitude }
        }

        /// Zooms in on the start line (street level, closer than `focus`) with it at `anchor`.
        func zoomToStart(_ coordinate: CLLocationCoordinate2D, anchor: CGPoint?) {
            focus(on: coordinate, anchor: anchor, minimumZoom: 15)
        }

        /// Frames the course above the bottom sheet and below the top chips.
        func fitCourse(animated: Bool) {
            guard let mapView, let all = mapView.annotations else { return }
            let annotations = all.filter { !($0 is RunnerPathPolyline) && !($0 is RunnerMarker) }
            guard annotations.isEmpty == false else { return }
            // A short map (iPhone Duo's outer display) shrinks the padding too; a tall one keeps it.
            let padding = Self.padding(fitPadding, in: mapView.bounds.size)
            mapView.showAnnotations(annotations, edgePadding: padding, animated: animated, completionHandler: nil)
        }

        /// `padding`, shrunk evenly when it would leave the course less than a quarter of the map
        /// (a map in a short pane), where the camera could only zoom out to the whole world. A
        /// tall enough map keeps its padding as it is.
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

        nonisolated func mapViewDidFinishRenderingMap(_ mapView: MLNMapView, fullyRendered: Bool) {
            guard fullyRendered else { return }
            MainActor.assumeIsolated {
                guard mapView.style != nil else { return }
                self.onRendered()
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
            let coordinate = mapView.convert(sender.location(in: mapView), toCoordinateFrom: mapView)
            if pickAnchor != nil {
                // Placing a checkpoint: the tapped spot slides under the crosshair.
                move(coordinate, underAnchorOf: mapView, animated: true)
                return
            }
            onTap(coordinate.latitude, coordinate.longitude)
        }

        /// Placing a checkpoint starts, moves its crosshair (the sheet changed height), or ends;
        /// or a typed position arrives.
        func updatePick(anchor: CGPoint?, target: PickTarget?, holding: CLLocationCoordinate2D?) {
            guard let mapView else { return }
            let anchorMoved = anchor != pickAnchor
            // The crosshair just appeared: the field takes the spot under it.
            let entering = pickAnchor == nil
            pickAnchor = anchor
            guard anchor != nil else {
                pickTargetId = target?.id
                return
            }
            if let target, target.id != pickTargetId {
                pickTargetId = target.id
                move(CLLocationCoordinate2D(latitude: target.latitude, longitude: target.longitude), underAnchorOf: mapView, animated: false)
                return
            }
            pickTargetId = target?.id
            guard anchorMoved else { return }
            if let holding, !entering {
                move(holding, underAnchorOf: mapView, animated: false)
            } else {
                reportPick()
            }
        }

        /// The spot under the crosshair, to the model. Only when the map has settled: a report
        /// every frame of a pan would lay the whole map screen out again each frame.
        private func reportPick() {
            guard let mapView, let point = anchorPoint(in: mapView) else { return }
            let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
            guard CLLocationCoordinate2DIsValid(coordinate) else { return }
            onPickCenter?(coordinate.latitude, coordinate.longitude)
        }

        private func anchorPoint(in mapView: MLNMapView) -> CGPoint? {
            guard let pickAnchor else { return nil }
            return mapView.convert(pickAnchor, from: nil)
        }

        /// Pans so `coordinate` sits under the crosshair, at the zoom the map has.
        private func move(_ coordinate: CLLocationCoordinate2D, underAnchorOf mapView: MLNMapView, animated: Bool) {
            guard let anchor = anchorPoint(in: mapView), CLLocationCoordinate2DIsValid(coordinate) else { return }
            let center = CGPoint(x: mapView.bounds.midX, y: mapView.bounds.midY)
            let offset = CGPoint(x: center.x - anchor.x, y: center.y - anchor.y)
            if animated {
                // A tapped spot, on screen: slide it to the crosshair.
                let point = mapView.convert(coordinate, toPointTo: mapView)
                let target = mapView.convert(CGPoint(x: point.x + offset.x, y: point.y + offset.y), toCoordinateFrom: mapView)
                mapView.setCenter(target, animated: true)
                return
            }
            // A typed spot, maybe far away: center it, then shift by the crosshair's offset.
            mapView.setCenter(coordinate, animated: false)
            let target = mapView.convert(CGPoint(x: center.x + offset.x, y: center.y + offset.y), toCoordinateFrom: mapView)
            mapView.setCenter(target, animated: false)
        }

        nonisolated func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            MainActor.assumeIsolated {
                guard self.pickAnchor != nil else { return }
                self.reportPick()
            }
        }
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
        layer.borderColor = UIColor(red: 0.204, green: 0.251, blue: 0.310, alpha: 1).cgColor
        layer.borderWidth = 1.5
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.12
        layer.shadowRadius = 6
        layer.shadowOffset = CGSize(width: 0, height: 2)
        label.font = Self.font
        label.adjustsFontForContentSizeCategory = true
        label.textColor = UIColor(red: 0.122, green: 0.153, blue: 0.188, alpha: 1)
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
