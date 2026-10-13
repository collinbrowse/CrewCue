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

    static let styleURL = URL(string: "https://demotiles.maplibre.org/style.json")

    func makeCoordinator() -> Coordinator {
        Coordinator(onTap: onTap, onStyleFailure: onStyleFailure, onStyleLoaded: onStyleLoaded)
    }

    func makeUIView(context: Context) -> MLNMapView {
        let mapView = MLNMapView(frame: .zero, styleURL: Self.styleURL)
        mapView.delegate = context.coordinator
        mapView.tintColor = UIColor.systemBlue
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
        context.coordinator.redraw(force: false)
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
                mapView.showAnnotations(annotations, animated: false)
            }
            drawnPoints = points
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
        backgroundColor = UIColor.white.withAlphaComponent(0.92)
        layer.cornerRadius = 4
        label.font = UIFont.preferredFont(forTextStyle: .caption1)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .black
        label.textAlignment = .center
        addSubview(label)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setTitle(_ title: String) {
        label.text = title
        label.font = UIFont.preferredFont(forTextStyle: .caption1)
        label.sizeToFit()
        let width = max(44, label.bounds.width + 16)
        let height = max(24, label.bounds.height + 8)
        bounds = CGRect(x: 0, y: 0, width: width, height: height)
        label.frame = bounds
    }
}
#endif
