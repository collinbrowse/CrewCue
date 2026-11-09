import CoreLocation
import Foundation
import CrewCueClientCore

/// The runner's race-day location source. Runs while the screen is locked (Always permission,
/// background location mode) and keeps one fix per interval. iOS gives no timers in the
/// background, so the kept sample is the first fix after the interval has passed.
/// Significant-change monitoring relaunches the app if it was killed; the app then resumes from
/// the saved `TrackingSession`.
@MainActor
final class RaceTrackingLocator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var armed = false
    private var intervalSeconds: TimeInterval = TimeInterval(TrackingSettings.defaultIntervalSeconds)
    private var lastKeptAt: Date?
    var onSample: (@MainActor (Double, Double, Double, Date) -> Void)?
    var onDenied: (@MainActor () -> Void)?
    /// Called once When In Use is granted; the app then asks for Always.
    var onWhenInUseOnly: (@MainActor () -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .fitness
    }

    var isRunning: Bool { armed }

    func start(intervalSeconds: Int) {
        self.intervalSeconds = TimeInterval(intervalSeconds)
        armed = true
        lastKeptAt = nil
        apply(manager.authorizationStatus)
    }

    func updateInterval(_ seconds: Int) {
        intervalSeconds = TimeInterval(seconds)
    }

    func stop() {
        armed = false
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
        manager.showsBackgroundLocationIndicator = false
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.apply(status)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fixes = locations.map { ($0.coordinate.latitude, $0.coordinate.longitude, $0.horizontalAccuracy, $0.timestamp) }
        Task { @MainActor in
            for fix in fixes {
                self.keep(latitude: fix.0, longitude: fix.1, accuracy: fix.2, at: fix.3)
            }
        }
    }

    /// One sample per interval, timestamped with the fix's own time (not the delivery time), so a
    /// sample taken in a dead zone keeps the moment the runner was there.
    private func keep(latitude: Double, longitude: Double, accuracy: Double, at time: Date) {
        guard armed else { return }
        if let lastKeptAt, time.timeIntervalSince(lastKeptAt) < intervalSeconds {
            return
        }
        lastKeptAt = time
        onSample?(latitude, longitude, accuracy, time)
    }

    private func apply(_ status: CLAuthorizationStatus) {
        guard armed else { return }
        switch status {
        case .authorizedAlways:
            run()
        case .authorizedWhenInUse:
            // Starting while the app is open keeps updates alive in the background with the blue
            // indicator; Always also lets significant-change wake a killed app.
            run()
            onWhenInUseOnly?()
            manager.requestAlwaysAuthorization()
        case .denied, .restricted:
            manager.stopUpdatingLocation()
            onDenied?()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        @unknown default:
            manager.requestWhenInUseAuthorization()
        }
    }

    private func run() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        if CLLocationManager.significantLocationChangeMonitoringAvailable() {
            manager.startMonitoringSignificantLocationChanges()
        }
    }
}
