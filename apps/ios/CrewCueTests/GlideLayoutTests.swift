import CoreLocation
import XCTest

/// `GlideLayout`: where the onboarding replay's gliding dot sits on the path the Map holds, and
/// where the trail stops. The path is ten points ten seconds apart going north; each frame glides
/// from one of them (`from`) to a moment (`at`).
final class GlideLayoutTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_786_000_000)
    private var times: [Date] { (0..<10).map { start.addingTimeInterval(Double($0) * 10) } }
    private var track: [CLLocationCoordinate2D] {
        (0..<10).map { CLLocationCoordinate2D(latitude: 39 + Double($0) * 0.001, longitude: -120) }
    }

    /// A frame at `seconds` into the path, gliding from point `from`. The dot is on the path's
    /// line at that moment.
    private func frame(at seconds: Double, from index: Int) -> RunnerGlideFrame {
        RunnerGlideFrame(latitude: 39 + seconds / 10 * 0.001, longitude: -120, at: start.addingTimeInterval(seconds), from: times[index])
    }

    private func layout(at seconds: Double, from index: Int, track: [CLLocationCoordinate2D]? = nil, times: [Date]? = nil) -> GlideLayout {
        GlideLayout(frame: frame(at: seconds, from: index), track: track ?? self.track, times: times ?? self.times)
    }

    func testAPathThatHasNotCaughtUpKeepsTheDotOnItsLastPoint() {
        // The glide runs to 120 s, the path read so far ends at 60 s (point 6).
        let shorter = Array(track.prefix(7))
        let shorterTimes = Array(times.prefix(7))
        for seconds in [61.0, 75, 120] {
            let glide = layout(at: seconds, from: 3, track: shorter, times: shorterTimes)
            XCTAssertEqual(glide.dot.latitude, shorter[6].latitude, "at \(seconds) s")
            XCTAssertEqual(glide.dot.longitude, shorter[6].longitude)
            XCTAssertEqual(glide.reached, 7)
            XCTAssertEqual(glide.stretch(of: shorter).last?.latitude, shorter[6].latitude)
        }
        // Caught up: the dot is the frame's.
        let caught = layout(at: 55, from: 3)
        XCTAssertEqual(caught.dot.latitude, frame(at: 55, from: 3).latitude)
    }

    func testReachedNeverPassesTheDot() {
        for tenths in 300...900 {
            let seconds = Double(tenths) / 10
            let glide = layout(at: seconds, from: 3)
            let moment = start.addingTimeInterval(seconds)
            XCTAssertTrue(times[..<glide.reached].allSatisfy { $0 <= moment }, "a point past the dot at \(seconds) s")
            if glide.reached < times.count {
                XCTAssertGreaterThan(times[glide.reached], moment, "a point behind the dot left out at \(seconds) s")
            }
            // The trail is the path up to the dot, and ends on it.
            let stretch = glide.stretch(of: track)
            XCTAssertTrue(stretch.dropLast().allSatisfy { $0.latitude <= glide.dot.latitude + 1e-12 }, "the trail runs past the dot at \(seconds) s")
            XCTAssertEqual(stretch.last?.latitude, glide.dot.latitude)
        }
    }

    func testTheStretchAlwaysHasTwoPoints() {
        let one = [track[0]]
        let oneTime = [times[0]]
        // Every point after the moment: nothing reached yet.
        let later = times.map { $0.addingTimeInterval(1000) }
        let cases: [(name: String, glide: GlideLayout, track: [CLLocationCoordinate2D])] = [
            ("the first point", layout(at: 0, from: 0), track),
            ("a one-point path", layout(at: 0, from: 0, track: one, times: oneTime), one),
            ("a one-point path not caught up", layout(at: 30, from: 0, track: one, times: oneTime), one),
            ("on a point", layout(at: 30, from: 3), track),
            ("between points", layout(at: 35, from: 3), track),
            ("the last point", layout(at: 90, from: 9), track),
            ("past the path's end", layout(at: 200, from: 9), track),
            ("before the path", layout(at: 5, from: 0, times: later), track)
        ]
        for (name, glide, path) in cases {
            let stretch = glide.stretch(of: path)
            XCTAssertGreaterThanOrEqual(stretch.count, 2, name)
            XCTAssertEqual(stretch.last?.latitude, glide.dot.latitude, name)
        }
    }

    func testSettledStaysTheSameWithinAGlide() {
        // From point 3 (30 s) to the path's end and past it: the path behind the glide's start
        // stays one shape, so only the stretch after it moves.
        let settled = (300...1200).map { layout(at: Double($0) / 10, from: 3).settled }
        XCTAssertEqual(Set(settled), [4])
        // The stretch starts on the last settled point.
        let glide = layout(at: 64, from: 3)
        XCTAssertEqual(glide.stretch(of: track).first?.latitude, track[3].latitude)
        XCTAssertEqual(glide.stretch(of: track).count, 5)
        // The next glide settles further on.
        XCTAssertEqual(layout(at: 80, from: 7).settled, 8)
    }
}
