import CoreLocation
import Foundation
import Observation

/// The map's "my location" button: this phone's own position, so a crew member can see where
/// they are against the course. It only moves the camera and draws the blue dot. Race progress
/// never reads it: that comes from the runner's pings alone.
///
/// Separate from `RaceTrackingLocator`, the runner's race-day sampler: asking where you are on
/// the map must not start (or stop) sharing a position with the crew.
@MainActor
@Observable
final class MyLocationModel: NSObject, CLLocationManagerDelegate {
    enum State: Equatable, Sendable {
        /// Never asked. A tap shows the system prompt.
        case notDetermined
        /// The system prompt is up.
        case requesting
        /// Allowed; waiting for the first fix.
        case locating
        /// Showing this phone's position. `approximate` when Precise Location is off.
        case showing(approximate: Bool)
        /// The person said no. Only Settings can change it.
        case denied
        /// Parental controls or device management don't allow location for apps.
        case restricted
        /// Location Services are off for the whole phone.
        case servicesOff
        /// Allowed, but no fix came (indoors, no sky, airplane mode).
        case unavailable
    }

    /// What the alert over the map explains, when a tap can't show a position.
    enum Problem: String, Identifiable, Sendable {
        case denied
        case restricted
        case servicesOff

        var id: String { rawValue }

        var title: String {
            switch self {
            case .denied: "Location is off for CrewCue"
            case .restricted: "Location isn't allowed"
            case .servicesOff: "Location Services are off"
            }
        }

        var message: String {
            switch self {
            case .denied:
                "To see where you are on the course map, allow location for CrewCue in Settings. Your position stays on this phone."
            case .restricted:
                "This phone's restrictions (Screen Time or device management) don't allow apps to use location."
            case .servicesOff:
                "Turn on Location Services in Settings > Privacy & Security to see where you are on the course map."
            }
        }

        /// Settings can fix it from here.
        var opensSettings: Bool { self != .restricted }
    }

    private(set) var state: State = .notDetermined
    /// The latest fix. Only the map's camera and blue dot read it.
    private(set) var coordinate: CLLocationCoordinate2D?
    /// Bumped to ask the map to center on `coordinate`.
    private(set) var centerRequest = 0
    /// The alert to show over the map, if any.
    var problem: Problem?
    /// A short note over the map (no fix, approximate), cleared after a few seconds.
    private(set) var notice: String?

    @ObservationIgnored private let manager = CLLocationManager()
    /// The person tapped the button and is waiting to be centered.
    @ObservationIgnored private var wantsCenter = false
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var fixTimeout: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 10
        state = Self.state(for: manager.authorizationStatus, approximate: manager.accuracyAuthorization == .reducedAccuracy)
    }

    /// Showing the dot on the map.
    var isShowing: Bool {
        if case .showing = state { return true }
        return false
    }

    var systemImage: String {
        switch state {
        case .showing: "location.fill"
        case .denied, .restricted, .servicesOff: "location.slash"
        default: "location"
        }
    }

    var buttonLabel: String {
        switch state {
        case .notDetermined: "Show my location"
        case .requesting: "Asking for location permission"
        case .locating: "Finding your location"
        case .showing(let approximate): approximate ? "Center on my approximate location" : "Center on my location"
        case .denied: "Location is off for CrewCue"
        case .restricted: "Location isn't allowed on this phone"
        case .servicesOff: "Location Services are off"
        case .unavailable: "Show my location, last try found no position"
        }
    }

    var isBusy: Bool { state == .requesting || state == .locating }

    /// The my location button.
    func tap() {
        switch manager.authorizationStatus {
        case .notDetermined:
            wantsCenter = true
            state = .requesting
            manager.requestWhenInUseAuthorization()
        case .denied:
            // Denied, or Location Services off for the whole phone (iOS reports both as denied).
            Task { await reportDenial() }
        case .restricted:
            state = .restricted
            problem = .restricted
        case .authorizedAlways, .authorizedWhenInUse:
            wantsCenter = true
            if coordinate != nil, isShowing {
                centerRequest += 1
                wantsCenter = false
            } else {
                begin()
            }
        @unknown default:
            wantsCenter = true
            manager.requestWhenInUseAuthorization()
        }
    }

    /// The map is on screen again: pick up a permission changed in Settings meanwhile.
    func refresh() {
        let status = manager.authorizationStatus
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            if case .showing = state { return }
            if state == .locating { return }
            if state == .denied || state == .servicesOff || state == .restricted {
                // Allowed in Settings since: show the dot now.
                wantsCenter = true
                begin()
            }
        default:
            stopUpdates()
            state = Self.state(for: status, approximate: false)
        }
    }

    private func begin() {
        state = .locating
        manager.startUpdatingLocation()
        fixTimeout?.cancel()
        fixTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, let self, self.state == .locating else { return }
            self.state = .unavailable
            self.wantsCenter = false
            self.show(notice: "Couldn't find your location. Try again with a clearer view of the sky.")
        }
    }

    private func stopUpdates() {
        manager.stopUpdatingLocation()
        fixTimeout?.cancel()
        coordinate = nil
    }

    private func reportDenial() async {
        // `locationServicesEnabled` can block, so it is asked off the main actor.
        let servicesOn = await Task.detached { CLLocationManager.locationServicesEnabled() }.value
        state = servicesOn ? .denied : .servicesOff
        problem = servicesOn ? .denied : .servicesOff
    }

    private func show(notice text: String) {
        notice = text
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    private static func state(for status: CLAuthorizationStatus, approximate: Bool) -> State {
        switch status {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .restricted: .restricted
        // Allowed but not yet asked to show: the button reads as ready, not as showing.
        case .authorizedAlways, .authorizedWhenInUse: .notDetermined
        @unknown default: .notDetermined
        }
    }

    // MARK: CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.authorizationChanged(status) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let coordinate = last.coordinate
        let approximate = manager.accuracyAuthorization == .reducedAccuracy
        Task { @MainActor in self.received(coordinate, approximate: approximate) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        Task { @MainActor in self.failed(code) }
    }

    private func authorizationChanged(_ status: CLAuthorizationStatus) {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            if wantsCenter || state == .requesting {
                begin()
            }
        case .denied:
            stopUpdates()
            let asked = state == .requesting
            state = .denied
            // Just said no to the prompt: no alert on top of that answer.
            if !asked, wantsCenter { Task { await reportDenial() } }
            wantsCenter = false
        case .restricted:
            stopUpdates()
            state = .restricted
            wantsCenter = false
        case .notDetermined:
            if state != .requesting { state = .notDetermined }
        @unknown default:
            break
        }
    }

    private func received(_ fix: CLLocationCoordinate2D, approximate: Bool) {
        let first = !isShowing
        fixTimeout?.cancel()
        coordinate = fix
        state = .showing(approximate: approximate)
        if wantsCenter {
            wantsCenter = false
            centerRequest += 1
            if first, approximate {
                show(notice: "Showing your approximate location. Turn on Precise Location in Settings for a closer fix.")
            }
        }
    }

    private func failed(_ code: CLError.Code?) {
        switch code {
        case .denied:
            authorizationChanged(.denied)
        case .locationUnknown:
            // Core Location keeps trying; the timeout reports if nothing comes.
            break
        default:
            guard state == .locating else { return }
            fixTimeout?.cancel()
            state = .unavailable
            wantsCenter = false
            show(notice: "Couldn't find your location. Try again with a clearer view of the sky.")
        }
    }
}
