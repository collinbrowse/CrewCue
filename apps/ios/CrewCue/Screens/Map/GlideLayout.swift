import CoreLocation
import Foundation

// The onboarding replay's gliding dot, as the Map draws it. Plain values with no MapLibre and no
// client-core, so CrewCueTests compiles this file on its own (the target's membership exception).

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
        let caughtUp = (times.last ?? .distantPast) >= frame.at
        reached = caughtUp ? Self.count(times, atOrBefore: frame.at) : times.count
        // A frame's `from` is never after its `at`, so this is never past the dot.
        settled = min(Self.count(times, atOrBefore: frame.from), reached)
        let dot = caughtUp ? frame.coordinate : (track.last ?? frame.coordinate)
        latitude = dot.latitude
        longitude = dot.longitude
    }

    /// The path from the last settled point through the points reached since, to the dot. At
    /// least two points, so the shape always draws.
    func stretch(of track: [CLLocationCoordinate2D]) -> [CLLocationCoordinate2D] {
        let end = min(reached, track.count)
        let start = min(max(0, settled - 1), end)
        var points = Array(track[start..<end])
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
