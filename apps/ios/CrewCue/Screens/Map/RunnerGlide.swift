import CoreLocation
import Foundation
import Observation
import CrewCueClientCore

/// One frame of the onboarding replay's runner dot (client-core `DemoRaceRunnerPosition`).
struct RunnerGlideFrame: Equatable, Sendable {
    var latitude: Double
    var longitude: Double
    /// Path points recorded at or before this are behind the dot: the trail stops at the dot.
    var at: Date
    /// Path points recorded at or before this were behind the dot when its glide began. They
    /// don't change until the next update.
    var from: Date

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    init(latitude: Double, longitude: Double, at: Date, from: Date) {
        self.latitude = latitude
        self.longitude = longitude
        self.at = at
        self.from = from
    }

    init(_ position: DemoRaceRunnerPosition) {
        self.init(latitude: position.latitude, longitude: position.longitude, at: position.recordedAt, from: position.fromRecordedAt)
    }
}

/// The onboarding replay's runner between updates: the Map samples it on every display frame
/// while the replay plays, so the dot glides along the course line from one ping to the next
/// (`DemoRacePlayer.runnerPosition`) and the trail grows behind it. Paused, it holds on the
/// paused moment. Only the replay has one. The race map's dot is always the runner's latest ping.
@MainActor
@Observable
final class RunnerGlide {
    /// The replay is playing: the map samples a frame on every display refresh.
    var isPlaying = false
    private let player: DemoRacePlayer

    init(player: DemoRacePlayer) {
        self.player = player
    }

    /// Where the dot is now. Nil before the first ping.
    func frame() -> RunnerGlideFrame? {
        player.runnerPosition.map(RunnerGlideFrame.init)
    }
}
