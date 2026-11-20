import Foundation
import CrewCueClientCore

extension RunnerGlideFrame {
    init(_ position: DemoRaceRunnerPosition) {
        self.init(latitude: position.latitude, longitude: position.longitude, at: position.recordedAt, from: position.fromRecordedAt)
    }
}

/// The onboarding replay's runner between updates: the Map samples it on every display frame
/// while the replay plays, so the dot glides along the course line from one ping to the next
/// (`DemoRacePlayer.runnerPosition`) and the trail grows behind it. Paused, it holds on the
/// paused moment. Whether it plays is `RacePreviewModel.isPlaying`, which the Map is given. Only
/// the replay has one. The race map's dot is always the runner's latest ping.
struct RunnerGlide: Sendable {
    let player: DemoRacePlayer

    /// Where the dot is now. Nil before the first ping.
    func frame() -> RunnerGlideFrame? {
        player.runnerPosition.map(RunnerGlideFrame.init)
    }
}
