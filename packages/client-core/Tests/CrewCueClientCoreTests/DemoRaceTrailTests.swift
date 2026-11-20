import Foundation
import Testing
@testable import CrewCueClientCore

// The replay's trail and dot follow the course line (clients/behavior/onboarding-race-preview.md):
// the path it serves runs along the line, not ping to ping, and the dot glides along the line
// between updates.

/// How far `latitude`/`longitude` is from the course polyline, and how far along the line its
/// nearest spot is, in meters. Measured independently of `DemoRaceCourse`: a flat projection
/// around the point, great-circle lengths along the line.
private func nearest(_ latitude: Double, _ longitude: Double, on line: [DemoRaceCoordinate]) -> (offset: Double, along: Double) {
    let radius = 6_371_000.0
    let scaleY = radius * .pi / 180
    let scaleX = scaleY * cos(latitude * .pi / 180)
    var best = (offset: Double.infinity, along: 0.0)
    var walked = 0.0
    for (a, b) in zip(line, line.dropFirst()) {
        let ax = (a.longitude - longitude) * scaleX, ay = (a.latitude - latitude) * scaleY
        let bx = (b.longitude - longitude) * scaleX, by = (b.latitude - latitude) * scaleY
        let dx = bx - ax, dy = by - ay
        let lengthSquared = dx * dx + dy * dy
        let t = lengthSquared > 0 ? min(max(-(ax * dx + ay * dy) / lengthSquared, 0), 1) : 0
        let px = ax + dx * t, py = ay + dy * t
        let offset = (px * px + py * py).squareRoot()
        let segment = greatCircle(a, b)
        if offset < best.offset {
            best = (offset, walked + segment * t)
        }
        walked += segment
    }
    return best
}

private func greatCircle(_ a: DemoRaceCoordinate, _ b: DemoRaceCoordinate) -> Double {
    let radius = 6_371_000.0
    let dLat = (b.latitude - a.latitude) * .pi / 180
    let dLon = (b.longitude - a.longitude) * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2)
        + cos(a.latitude * .pi / 180) * cos(b.latitude * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * radius * atan2(h.squareRoot(), max(0, 1 - h).squareRoot())
}

/// A race whose course line is `line` (`[longitude, latitude]`), `meters` long, planned to finish
/// in `finishSeconds`.
private func trailRoom(line: [[Double]], meters: Double, finishSeconds: Double) throws -> Data {
    let first = line[0], last = line[line.count - 1], middle = line[line.count / 2]
    let checkpoint = { (id: String, point: [Double], distance: Double) -> [String: Any] in
        ["id": id, "title": id, "latitude": point[1], "longitude": point[0], "distanceMetersFromStart": distance]
    }
    let room: [String: Any] = [
        "id": "room-trail", "teamId": "team-1", "athleteId": "runner-1", "name": "Switchbacks", "status": "active",
        "createdAt": "2026-08-01T00:00:00.000Z", "raceStartAt": "2026-08-15T12:00:00.000Z",
        "memberships": [["userId": "runner-1", "role": "athlete", "joinedAt": "2026-08-01T00:00:00.000Z", "displayName": "Ada"]],
        "entitlement": ["status": "unpaid", "lastUpdatedAt": "2026-08-01T00:00:00.000Z", "source": "none"],
        "course": ["checkpoints": [
            checkpoint("start", first, 0), checkpoint("aid-1", middle, meters / 2), checkpoint("finish", last, meters)
        ]],
        "courseDistanceMeters": meters,
        "plannedPaceSecondsPerKm": finishSeconds / (meters / 1000),
        "mapWorkspace": [
            "drivesProjectionLayerId": "course",
            "layers": [["id": "course", "geometry": ["type": "LineString", "coordinates": line]]]
        ]
    ]
    return try JSONSerialization.data(withJSONObject: ["room": room])
}

/// Switchbacks: `legs` legs of `vertices` each, about `spacing` meters apart, turning back and
/// forth up a slope, so any chord between two far pings cuts across the course.
private func switchbacks(legs: Int, vertices: Int, spacing: Double) -> [[Double]] {
    let degreesPerMeter = 1 / 111_320.0
    let east = spacing * degreesPerMeter / cos(39.2 * .pi / 180)
    var line: [[Double]] = []
    for leg in 0..<legs {
        let latitude = 39.2 + Double(leg) * 60 * degreesPerMeter
        for step in 0..<vertices {
            let along = leg.isMultiple(of: 2) ? step : vertices - 1 - step
            // A slight bow on every leg, so the line has a vertex that matters at each step.
            let bow = sin(Double(step) / Double(vertices - 1) * .pi) * 15 * degreesPerMeter
            line.append([-120.2 + Double(along) * east, latitude + bow])
        }
    }
    return line
}

/// The races the replay has to follow: the onboarding test race (5 vertices), the dev route's
/// fixture (9 vertices, 2 km apart), switchbacks (vertices every 40 m), and a short fast race on a
/// line with a vertex every 2 m (more vertices than race seconds between some pings).
private func courses() throws -> [(name: String, data: Data)] {
    [
        ("onboarding", try demoRoomData()),
        ("fixture", DemoRaceFixture.roomData),
        ("switchbacks", try trailRoom(line: switchbacks(legs: 12, vertices: 40, spacing: 40), meters: 19_000, finishSeconds: 3 * 3600)),
        ("dense", try trailRoom(line: switchbacks(legs: 4, vertices: 250, spacing: 2), meters: 2_000, finishSeconds: 900))
    ]
}

private func replay(_ data: Data, clock: ManualWallClock) throws -> DemoRaceSession {
    try DemoRace.session(roomData: data, viewerUserId: "runner-1", logger: SilentLogger(), temporaryRoot: freshDirectory(), wallClock: clock)
}

/// Every path point the replay's `GET .../pings/track` serves, read the way the Map reads it: a
/// cursor read after every step, so points that arrive with a step come in that step's read.
private func servedPath(_ demo: DemoRaceSession, _ clock: ManualWallClock, through seconds: Double) async throws -> (track: RunnerTrack, latest: [RunnerProgress]) {
    var track = RunnerTrack.empty
    var latest: [RunnerProgress] = []
    demo.player.play()
    for wall in stride(from: 0.0, through: seconds, by: DemoRaceScript.stepSeconds) {
        clock.set(wall)
        demo.player.tick()
        track = try await RaceDayAPI.refreshTrack(graph: demo.graph, roomId: demo.roomId, track: track, maxPages: 50)
        latest.append(try await RaceDayAPI.latestPing(graph: demo.graph, roomId: demo.roomId))
    }
    return (track, latest)
}

@Test func demoRaceServedPathLiesOnTheCourseLineAndFollowsIt() async throws {
    for (name, data) in try courses() {
        let clock = ManualWallClock()
        let demo = try replay(data, clock: clock)
        let line = demo.player.script.course.line
        let (track, latest) = try await servedPath(demo, clock, through: 24.5)
        #expect(track.points.count == demo.player.script.track(through: 49).count, "\(name): the whole path was served")
        #expect(track.points.count > demo.player.script.pings(through: 49).count, "\(name): more than the pings")

        // Every served point, and every latest ping, is on the course line.
        let placed = track.points.map { nearest($0.latitude, $0.longitude, on: line) }
        #expect(placed.allSatisfy { $0.offset < 1 }, "\(name): \(placed.map(\.offset).max() ?? 0) m off the course")
        for progress in latest {
            let ping = try #require(progress.ping)
            #expect(nearest(ping.latitude, ping.longitude, on: line).offset < 1, "\(name): latest ping off the course")
        }
        // Oldest first, never backwards along the course, and never two at one wire time.
        let along = placed.map(\.along)
        #expect(zip(along, along.dropFirst()).allSatisfy { $0 <= $1 + 0.01 }, "\(name): the path goes backwards")
        let times = track.points.map(\.recordedAt)
        #expect(zip(times, times.dropFirst()).allSatisfy { $0 < $1 }, "\(name): times out of order")

        // A line drawn through the served points follows the course: halfway between any two
        // neighbours is still on it, so no chord cuts across a bend.
        for (a, b) in zip(track.points, track.points.dropFirst()) {
            let middle = nearest((a.latitude + b.latitude) / 2, (a.longitude + b.longitude) / 2, on: line)
            #expect(middle.offset < 1, "\(name): a chord leaves the course by \(middle.offset) m")
        }
        demo.player.skip()
    }
}

@Test func demoRaceFollowingBeatServesAPointAtLeastEvery150Meters() async throws {
    for (name, data) in try courses() {
        let clock = ManualWallClock()
        let demo = try replay(data, clock: clock)
        let line = demo.player.script.course.line
        let following = demo.player.script.steps.filter { $0.beat == .following }
        let (track, _) = try await servedPath(demo, clock, through: try #require(following.last).wallOffsetSeconds)
        let along = track.points.map { nearest($0.latitude, $0.longitude, on: line).along }
        let gaps = zip(along, along.dropFirst()).map { $1 - $0 }
        #expect(!gaps.isEmpty)
        #expect(gaps.allSatisfy { $0 <= 150 }, "\(name): \(gaps.max() ?? 0) m between two served points")
        // Up to the following beat's last ping, 36% of the course line.
        let last = try #require(following.flatMap(\.pings).last)
        #expect(abs((along.last ?? 0) - last.lineMeters) < 1, "\(name)")
        demo.player.skip()
    }
}

@Test func demoRacePathIncludesEveryCourseVertexItPasses() throws {
    let course = try DemoRaceCourse(
        roomData: try trailRoom(line: switchbacks(legs: 12, vertices: 40, spacing: 40), meters: 19_000, finishSeconds: 3 * 3600),
        viewerUserId: "runner-1"
    )
    let script = DemoRaceScript(course: course)
    let path = script.track(through: script.steps.count - 1)
    let reached = try #require(path.last).lineMeters
    let passed = course.vertexMeters.filter { $0 <= reached }
    let served = Set(path.map(\.lineMeters))
    #expect(passed.count > 100)
    #expect(passed.allSatisfy { served.contains($0) }, "a vertex the runner passed is missing from the path")
    // Each path point is at its own place on the line.
    for point in path {
        let spot = course.position(atLineMeters: point.lineMeters)
        #expect(spot.latitude == point.latitude && spot.longitude == point.longitude)
    }
}

@Test func demoRacePathPointsArriveWithThePingAfterThem() throws {
    let course = try DemoRaceCourse(roomData: DemoRaceFixture.roomData, viewerUserId: DemoRaceFixture.runnerUserId)
    let script = DemoRaceScript(course: course)
    for step in script.steps {
        // A step without a ping serves nothing new, so Last update and the dead zone age as before.
        #expect(step.track.isEmpty == step.pings.isEmpty)
        guard let last = step.pings.last else { continue }
        #expect(step.track.last?.recordedAt == last.recordedAt)
        #expect(step.track.allSatisfy { $0.recordedAt <= last.recordedAt && $0.recordedAt <= step.now })
        // Every ping of the step is in its path, in order.
        let times = step.track.map(\.recordedAt)
        #expect(step.pings.allSatisfy { times.contains($0.recordedAt) })
    }
    // The dead zone still brings its six samples in one step, the path between them with them.
    let backlog = try #require(script.steps.first { $0.pings.count == 6 })
    #expect(backlog.beat == .deadZone)
    #expect(backlog.track.count > 6)
    #expect(script.steps.filter { $0.beat == .deadZone && $0.index < backlog.index }.allSatisfy { $0.track.isEmpty })
}

@Test func demoRaceRunnerGlidesAlongTheCourseAndNeverMovesBackwards() throws {
    for (name, data) in try courses() {
        let course = try DemoRaceCourse(roomData: data, viewerUserId: "runner-1")
        let script = DemoRaceScript(course: course)
        #expect(script == DemoRaceScript(course: try DemoRaceCourse(roomData: data, viewerUserId: "runner-1")))
        var previous: DemoRaceRunnerPosition?
        var moves: [Double] = []
        // A sample every 60 Hz frame across the whole replay.
        for frame in 0...(Int(DemoRaceScript.durationSeconds) * 60) {
            let wall = Double(frame) / 60
            let position = try #require(script.runnerPosition(atWallSeconds: wall), "\(name) at \(wall) s")
            #expect(nearest(position.latitude, position.longitude, on: course.line).offset < 1, "\(name): the dot leaves the course at \(wall) s")
            let spot = course.position(atLineMeters: position.lineMeters)
            #expect(abs(spot.latitude - position.latitude) < 1e-12 && abs(spot.longitude - position.longitude) < 1e-12)
            // Never ahead of what the replay has served by then.
            let step = script.stepIndex(atWallSeconds: wall)
            let latest = try #require(script.pings(through: step).last)
            #expect(position.lineMeters <= latest.lineMeters + 1e-6 && position.recordedAt <= latest.recordedAt, "\(name): ahead at \(wall) s")
            #expect(position.fromRecordedAt <= position.recordedAt)
            if let previous {
                #expect(position.lineMeters >= previous.lineMeters - 1e-6, "\(name): backwards at \(wall) s")
                #expect(position.recordedAt >= previous.recordedAt, "\(name): back in time at \(wall) s")
                moves.append(position.lineMeters - previous.lineMeters)
            }
            previous = position
        }
        // It glides: no frame jumps more than a few percent of the course line.
        #expect((moves.max() ?? 0) < course.lineLengthMeters * 0.03, "\(name): the dot jumps \(moves.max() ?? 0) m in a frame")
        #expect(moves.filter { $0 > 0 }.count > 500, "\(name): the dot hardly moves")
    }
}

@Test func demoRaceRunnerStartsEachGlideWhereTheLastEndedAndHoldsThroughTheDeadZone() throws {
    let course = try DemoRaceCourse(roomData: DemoRaceFixture.roomData, viewerUserId: DemoRaceFixture.runnerUserId)
    let script = DemoRaceScript(course: course)
    let updates = script.steps.filter { !$0.pings.isEmpty }
    for (before, update) in zip(updates, updates.dropFirst()) {
        // As a step brings pings, the dot is still on the latest ping before them.
        let start = try #require(script.runnerPosition(atWallSeconds: update.wallOffsetSeconds))
        let latest = try #require(before.pings.last)
        #expect(start.lineMeters == latest.lineMeters)
        #expect(start.fromRecordedAt == latest.recordedAt)
    }
    // Following: a second after each ping the dot is on it.
    for update in updates.filter({ $0.beat == .following }) {
        let reached = try #require(script.runnerPosition(atWallSeconds: update.wallOffsetSeconds + DemoRaceScript.glideSeconds))
        let ping = try #require(update.pings.last)
        #expect(reached.lineMeters == ping.lineMeters)
        // Halfway there it is between the two, on the line.
        let halfway = try #require(script.runnerPosition(atWallSeconds: update.wallOffsetSeconds + DemoRaceScript.glideSeconds / 2))
        #expect(halfway.lineMeters <= reached.lineMeters)
    }
    // The dead zone: no ping, so the dot stands on the last one until the backlog arrives.
    let lastBefore = try #require(script.steps.filter { $0.beat == .fallingBehind }.flatMap(\.pings).last)
    let backlog = try #require(script.steps.first { $0.pings.count == 6 })
    for wall in stride(from: 14.0, to: backlog.wallOffsetSeconds, by: 0.25) {
        #expect(script.runnerPosition(atWallSeconds: wall)?.lineMeters == lastBefore.lineMeters)
    }
    // Then it runs along the six samples to the newest, before the next ping comes.
    let next = try #require(updates.first { $0.index > backlog.index })
    let caughtUp = try #require(script.runnerPosition(atWallSeconds: next.wallOffsetSeconds))
    let newest = try #require(backlog.pings.last)
    #expect(caughtUp.lineMeters == newest.lineMeters)
    #expect(script.runnerPosition(atWallSeconds: DemoRaceScript.durationSeconds)?.lineMeters == script.pings(through: 49).last?.lineMeters)
}

@Test func demoRacePlayerRunnerHoldsWhenPausedAndNeverRunsAheadOfTheServedStep() throws {
    let clock = ManualWallClock()
    let demo = try replay(DemoRaceFixture.roomData, clock: clock)
    let player = demo.player
    let script = player.script
    // Before playing: on the start.
    #expect(player.runnerPosition?.lineMeters == 0)

    player.play()
    clock.set(3.25)
    player.tick()
    let playing = try #require(player.runnerPosition)
    #expect(playing == script.runnerPosition(atWallSeconds: 3.25))
    let first = try #require(script.pings(through: 4).last).lineMeters
    let second = try #require(script.pings(through: 6).last).lineMeters
    #expect(playing.lineMeters > first && playing.lineMeters < second)

    // Paused: it holds exactly at that moment however long the pause.
    player.pause()
    clock.advance(30)
    player.tick()
    #expect(player.runnerPosition == playing)

    // The wall clock moves past the next ping before the replay's step does: the dot waits on
    // the newest ping served, then glides on once the step is.
    player.play()
    clock.advance(1)
    #expect(player.snapshot.stepIndex == 6)
    let held = try #require(player.runnerPosition)
    #expect(held.lineMeters == second)
    let served = try #require(script.pings(through: 6).last)
    #expect(held.recordedAt == served.recordedAt)
    player.tick()
    #expect(player.snapshot.stepIndex == 8)
    #expect(player.runnerPosition == script.runnerPosition(atWallSeconds: 4.25))
    let gliding = try #require(player.runnerPosition)
    #expect(gliding.lineMeters > second)

    // The dev route's paused moment (`?at=`): the dot is where that moment puts it.
    let other = try replay(DemoRaceFixture.roomData, clock: ManualWallClock())
    other.player.seek(toWallSeconds: 12.25)
    #expect(other.player.runnerPosition == script.runnerPosition(atWallSeconds: 12.25))
    other.player.skip()
    player.skip()
}
