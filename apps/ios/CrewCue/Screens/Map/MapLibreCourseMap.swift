import CoreLocation
import SwiftUI
import UIKit

#if canImport(MapLibre)
import MapLibre

struct MapLibreCourseMap: UIViewRepresentable {
    var points: [MapCoursePoint]
    var onTap: (Double, Double) -> Void
    var onStyleFailure: (Bool) -> Void
    var onStyleLoaded: () -> Void
    var recenterRequest = 0
    var lineColor = UIColor(red: 0.329, green: 0.251, blue: 0.725, alpha: 1)

    static let fallbackStyleURL = URL(string: "https://demotiles.maplibre.org/style.json")

    /// MapTiler topo when a key is configured (see apps/ios/Config/CrewCue.xcconfig), else the demo style.
    static func styleURL(dark: Bool, bundle: Bundle = .main) -> URL? {
        let key = (bundle.object(forInfoDictionaryKey: "CrewCueMapTilerKey") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard key.isEmpty == false, key.hasPrefix("$(") == false else { return fallbackStyleURL }
        let style = dark ? "topo-v2-dark" : "topo-v2"
        return URL(string: "https://api.maptiler.com/maps/\(style)/style.json?key=\(key)")
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTap: onTap, onStyleFailure: onStyleFailure, onStyleLoaded: onStyleLoaded)
    }

    func makeUIView(context: Context) -> MLNMapView {
        let dark = context.environment.colorScheme == .dark
        let mapView = MLNMapView(frame: .zero, styleURL: Self.styleURL(dark: dark))
        context.coordinator.dark = dark
        mapView.delegate = context.coordinator
        mapView.tintColor = lineColor
        mapView.logoView.isHidden = true
        // Keep MapTiler/OSM attribution reachable: below the top bar and status chips.
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
        context.coordinator.lineColor = lineColor
        let dark = context.environment.colorScheme == .dark
        if context.coordinator.dark != dark {
            context.coordinator.dark = dark
            mapView.styleURL = Self.styleURL(dark: dark)
        }
        context.coordinator.redraw(force: false)
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
        var lineColor = UIColor.systemPurple
        private var drawnPoints: [MapCoursePoint] = []

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
            if !force, points == drawnPoints { return }
            if let existing = mapView.annotations {
                mapView.removeAnnotations(existing)
            }
            var annotations: [MLNAnnotation] = []
            if points.count >= 2 {
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
        }

        /// Frames the course above the bottom sheet and below the top chips.
        func fitCourse(animated: Bool) {
            guard let mapView, let annotations = mapView.annotations, annotations.isEmpty == false else { return }
            let padding = UIEdgeInsets(top: 210, left: 48, bottom: 380, right: 90)
            mapView.showAnnotations(annotations, edgePadding: padding, animated: animated, completionHandler: nil)
        }

        nonisolated func mapView(_ mapView: MLNMapView, strokeColorForShapeAnnotation annotation: MLNShape) -> UIColor {
            MainActor.assumeIsolated { self.lineColor }
        }

        nonisolated func mapView(_ mapView: MLNMapView, lineWidthForPolylineAnnotation annotation: MLNPolyline) -> CGFloat {
            5
        }

        nonisolated func mapView(_ mapView: MLNMapView, alphaForShapeAnnotation annotation: MLNShape) -> CGFloat {
            0.95
        }

        nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            MainActor.assumeIsolated {
                self.onStyleLoaded()
                self.drawnPoints = []
                self.redraw(force: true)
            }
        }

        nonisolated func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
            let offline = MapLibreCourseMap.isOffline(error)
            MainActor.assumeIsolated {
                self.onStyleFailure(offline)
            }
        }

        nonisolated func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard let point = annotation as? MLNPointAnnotation else { return nil }
            let title = point.title ?? ""
            return MainActor.assumeIsolated {
                self.checkpointView(title: title)
            }
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
