import Foundation

public enum DemoRaceError: Error, Equatable, Sendable {
    /// A request for a host other than this replay's. The replay never does real I/O.
    case foreignHost(String)
    /// Writes (pings, chat, plans) never leave the replay.
    case readOnly(String)
    /// The replay finished or was skipped; its graph answers nothing more.
    case ended
    case invalidRoom
    case noCourse
    case noStartTime

    public var message: String {
        switch self {
        case .foreignHost(let url): "The race-day replay only answers its own host, not \(url)."
        case .readOnly(let request): "The race-day replay is read-only: \(request)."
        case .ended: "The race-day replay has ended."
        case .invalidRoom: "Couldn't read the race for the replay."
        case .noCourse: "The replay needs a course with at least two checkpoints."
        case .noStartTime: "The replay needs the race start time."
        }
    }
}

public struct DemoRaceCoordinate: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
}

/// The runner's real race, read once from `GET /race-rooms/:roomId` (the unpaid teaser room):
/// its course line, checkpoints and finish ETA. Nothing here is invented except what the replay
/// script adds on top.
public struct DemoRaceCourse: Equatable, Sendable {
    public var roomId: String
    public var viewerUserId: String
    public var raceStart: Date
    /// Planned finish, from the race start.
    public var plannedFinishSeconds: Double
    public var courseLengthMeters: Double
    public var plannedPaceSecondsPerKm: Double
    public var plannedStopSeconds: Double
    public var line: [DemoRaceCoordinate]
    public var startCheckpointId: String
    public var finishCheckpointId: String
    /// Every checkpoint between the start and the finish: the teaser withholds their ETAs.
    public var lockedCheckpointIds: [String]
    public var pacingEstimateId: String?
    public var members: [ChatRoomMember]
    /// The `GET /race-rooms/:roomId` body in the teaser shape (no plan curve, no aid ETAs).
    var roomBody: Data
    private var cumulativeMeters: [Double]

    /// `finishEtaAt` overrides the room's finish (for example the teaser projection's).
    public init(roomData: Data, viewerUserId: String, finishEtaAt: Date? = nil) throws {
        guard let root = try? JSONSerialization.jsonObject(with: roomData) as? [String: Any] else {
            throw DemoRaceError.invalidRoom
        }
        var envelope = root["room"] is [String: Any] ? root : ["room": root]
        guard var roomObject = envelope["room"] as? [String: Any] else { throw DemoRaceError.invalidRoom }
        // The teaser shape, whatever the input: no plan curve, and the estimate keeps the finish only.
        if var course = roomObject["course"] as? [String: Any] {
            course["baselineTrack"] = nil
            roomObject["course"] = course
        }
        if var plan = roomObject["pacingEstimate"] as? [String: Any] {
            plan["aidEtas"] = [Any]()
            roomObject["pacingEstimate"] = plan
        }
        envelope["room"] = roomObject
        guard let roomJSON = try? JSONSerialization.data(withJSONObject: roomObject),
              let room = try? JSONDecoder().decode(RaceRoom.self, from: roomJSON) else {
            throw DemoRaceError.invalidRoom
        }
        let ordered = Self.courseOrder(room.course?.checkpoints ?? [])
        guard ordered.count >= 2, let first = ordered.first, let last = ordered.last else { throw DemoRaceError.noCourse }

        let points = (CoursePayload.make(from: try JSONSerialization.data(withJSONObject: envelope))["line"] as? [[Double]] ?? [])
            .compactMap { pair in pair.count >= 2 ? DemoRaceCoordinate(latitude: pair[1], longitude: pair[0]) : nil }
        let line = points.count >= 2 ? points : ordered.map { DemoRaceCoordinate(latitude: $0.latitude, longitude: $0.longitude) }
        var cumulative: [Double] = [0]
        for (from, to) in zip(line, line.dropFirst()) {
            cumulative.append(cumulative[cumulative.count - 1] + Self.meters(from, to))
        }
        let measured = ordered.compactMap(\.distanceMetersFromStart).filter { $0.isFinite && $0 > 0 }.max()
        let length = measured ?? room.courseDistanceMeters.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? cumulative.last ?? 0
        guard length > 0 else { throw DemoRaceError.noCourse }

        let estimate = room.pacingEstimate
        let estimateFinish = estimate.flatMap { ScheduleFormat.parseISO8601($0.expectedFinishAt) }
        // The server's race clock: `raceStartAt`, else the legacy `activatedAt`, else the plan's.
        let start = OnboardingRace.raceClockStart(raceStartAt: room.raceStartAt, activatedAt: room.activatedAt)
            .flatMap(ScheduleFormat.parseISO8601)
            ?? estimateFinish.flatMap { finish in estimate.map { finish.addingTimeInterval(-$0.expectedFinishElapsedSeconds) } }
        guard let start else { throw DemoRaceError.noStartTime }
        let roomPace = room.plannedPaceSecondsPerKm.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
        let candidates: [Double?] = [
            finishEtaAt.map { $0.timeIntervalSince(start) },
            estimateFinish.map { $0.timeIntervalSince(start) },
            estimate?.expectedFinishElapsedSeconds,
            length / 1000 * (roomPace ?? 360)
        ]
        let finishSeconds = candidates.compactMap { $0 }.first { $0.isFinite && $0 > 0 } ?? length / 1000 * 360

        self.roomId = room.id
        self.viewerUserId = viewerUserId
        self.raceStart = start
        self.plannedFinishSeconds = finishSeconds
        self.courseLengthMeters = length
        self.plannedPaceSecondsPerKm = roomPace ?? finishSeconds / (length / 1000)
        self.plannedStopSeconds = ordered.reduce(0) { $0 + max(0, $1.plannedStopSeconds ?? 0) }
        self.line = line
        self.startCheckpointId = first.id
        self.finishCheckpointId = last.id
        var locked: [String] = []
        for checkpoint in ordered.dropFirst().dropLast() where checkpoint.id != first.id && checkpoint.id != last.id && !locked.contains(checkpoint.id) {
            locked.append(checkpoint.id)
        }
        self.lockedCheckpointIds = locked
        self.pacingEstimateId = room.pacingEstimateId ?? estimate?.id
        self.members = room.memberships.map { ChatRoomMember(userId: $0.userId, displayName: $0.displayName) }
        self.roomBody = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        self.cumulativeMeters = cumulative
    }

    /// The course line's own length, great-circle over its vertices. Places along the line are in
    /// these meters (`position(atLineMeters:)`); they can differ from `courseLengthMeters`, the
    /// race's measured distance.
    public var lineLengthMeters: Double { cumulativeMeters.last ?? 0 }

    /// Meters along the line from its start to each vertex of `line`.
    var vertexMeters: [Double] { cumulativeMeters }

    /// The point `fraction` of the way along the course line.
    public func position(atFraction fraction: Double) -> DemoRaceCoordinate {
        position(atLineMeters: min(max(fraction, 0), 1) * lineLengthMeters)
    }

    /// The point `meters` along the course line from its start. It lies on the line, between the
    /// two vertices either side of it, never on a chord across a bend.
    public func position(atLineMeters meters: Double) -> DemoRaceCoordinate {
        let total = lineLengthMeters
        guard total > 0, meters.isFinite, let first = line.first else { return line.first ?? DemoRaceCoordinate(latitude: 0, longitude: 0) }
        let target = min(max(meters, 0), total)
        // The first vertex at or past `target`, after the start.
        var low = 1
        var high = cumulativeMeters.count - 1
        while low < high {
            let middle = (low + high) / 2
            if cumulativeMeters[middle] >= target { high = middle } else { low = middle + 1 }
        }
        guard low > 0, low < line.count else { return first }
        let span = cumulativeMeters[low] - cumulativeMeters[low - 1]
        let t = span > 0 ? (target - cumulativeMeters[low - 1]) / span : 0
        let a = line[low - 1], b = line[low]
        return DemoRaceCoordinate(latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t)
    }

    /// The server's course order: by distance when every checkpoint has one, else as listed.
    static func courseOrder(_ checkpoints: [RaceCourseCheckpoint]) -> [RaceCourseCheckpoint] {
        let measured = checkpoints.allSatisfy { $0.distanceMetersFromStart?.isFinite == true }
        guard measured else { return checkpoints }
        return checkpoints.enumerated()
            .sorted { ($0.element.distanceMetersFromStart ?? 0, $0.offset) < ($1.element.distanceMetersFromStart ?? 0, $1.offset) }
            .map(\.element)
    }

    private static func meters(_ a: DemoRaceCoordinate, _ b: DemoRaceCoordinate) -> Double {
        let radius = 6_371_000.0
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(a.latitude * .pi / 180) * cos(b.latitude * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radius * atan2(sqrt(h), sqrt(max(0, 1 - h)))
    }
}

public enum DemoRaceBeat: String, CaseIterable, Sendable {
    case following, fallingBehind, deadZone, crewChat

    public var number: Int {
        (Self.allCases.firstIndex(of: self) ?? 0) + 1
    }

    /// One source for the replay captions: `OnboardingCopy`, so iOS and Android show the same text.
    public var caption: String { OnboardingCopy.replayCaption(self) }
}

public struct DemoRacePing: Equatable, Sendable {
    public var pingId: String
    public var latitude: Double
    public var longitude: Double
    public var recordedAt: Date
    public var receivedAt: Date
    public var progressMeters: Double
    /// Where the ping is along the course line (`DemoRaceCourse.position(atLineMeters:)`).
    public var lineMeters: Double
}

/// One point of the runner's path as the replay serves it (`GET .../pings/track`): a ping, or a
/// point the replay adds between two pings along the course line. Those are the line's own
/// vertices and, where vertices are further apart, a point at most
/// `DemoRaceScript.trackSpacingMeters` along from the last, so a line drawn through the served
/// points follows the course instead of cutting across it.
public struct DemoRaceTrackPoint: Equatable, Sendable {
    public var recordedAt: Date
    public var latitude: Double
    public var longitude: Double
    /// Meters along the course line from its start.
    public var lineMeters: Double
}

/// Where the runner's dot is at one moment of the replay (`DemoRaceScript.runnerPosition`): on the
/// course line, gliding from the latest ping before an update to the update's newest one.
public struct DemoRaceRunnerPosition: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    /// Meters along the course line from its start.
    public var lineMeters: Double
    /// The race moment the dot shows. Served path points recorded at or before it are behind the
    /// dot; a trail drawn to the dot stops there.
    public var recordedAt: Date
    /// The latest ping before the update this glide plays out: path points recorded at or before
    /// it stay put until the next update.
    public var fromRecordedAt: Date
}

public struct DemoRaceChatMessage: Equatable, Sendable {
    public var seq: Int
    public var senderUserId: String
    public var text: String
    public var createdAt: Date
}

public struct DemoRaceStep: Equatable, Sendable {
    public var index: Int
    public var wallOffsetSeconds: Double
    public var beat: DemoRaceBeat
    /// What the replay's clock reads from this step on.
    public var now: Date
    /// Pings that reach the server at this step, oldest first. The last is the new latest ping.
    public var pings: [DemoRacePing]
    /// The path points that reach the server with them (`GET .../pings/track`), oldest first: for
    /// each ping, the points along the course line since the ping before it, then the ping.
    public var track: [DemoRaceTrackPoint] = []
    /// The live finish ETA from this step on.
    public var finishEtaAt: Date
    public var chat: [DemoRaceChatMessage]
}

/// The replay, step by step: a pure function of the course, so the same race always plays the
/// same way. 50 steps half a second apart (25 s):
/// 1. following (0–10 s): the runner moves 0–36% of the course on plan, a ping every second; the
///    half-second between pings ages Last update by up to 5 minutes, never to stale.
/// 2. fallingBehind (10–14 s): from 40% the runner slows; the finish ETA moves 4, 8, then 12
///    minutes later.
/// 3. deadZone (14–20 s): no ping for 18 minutes, so the runner goes stale and Last update reads
///    18 MIN AGO; then the six samples saved meanwhile arrive in one step.
/// 4. crewChat (20–25 s): pings resume and a crew message arrives at 22 s.
///
/// Every ping lies on the course line, and so does the path the replay serves: between two pings
/// it adds the line's own vertices and a point at least every `trackSpacingMeters`, so a trail
/// drawn through the path follows the course. Those points only come with the ping after them, so
/// Last update, the dead zone and the finish ETA move exactly as the pings say.
/// `runnerPosition(atWallSeconds:)` glides the dot along the course between updates.
public struct DemoRaceScript: Equatable, Sendable {
    public static let durationSeconds = 25.0
    public static let stepSeconds = 0.5
    public static let deadZoneSeconds = 18 * 60.0
    public static let finishDelaySeconds = 12 * 60.0
    /// The server's default threshold (no upload interval declared): an 18-minute gap is stale.
    public static let stalenessThresholdSeconds = RunnerProgress.defaultStalenessThresholdSeconds
    public static let crewUserId = "demo-crew"
    public static let crewDisplayName = "Your crew"
    public static let crewMessage = "Saw your pings come back in. We'll be ready at the next aid."
    /// The most course line between two neighbouring points of the served path.
    public static let trackSpacingMeters = 100.0
    /// How long the dot takes to glide to a new latest ping: the ping cadence while following
    /// (every other step), so it never stops between pings. Less when the next update comes sooner.
    public static let glideSeconds = 1.0

    public let course: DemoRaceCourse
    public let steps: [DemoRaceStep]
    /// Every step's `track`, in order, and where each step's points end in it.
    private let path: [DemoRaceTrackPoint]
    private let pathEnds: [Int]
    /// The steps that bring pings, each with the stretch of path its glide runs along.
    private let glides: [DemoRaceGlide]

    public init(course: DemoRaceCourse) {
        self.course = course
        let steps = Self.densify(Self.build(course), course: course)
        self.steps = steps
        var path: [DemoRaceTrackPoint] = []
        var ends: [Int] = []
        for step in steps {
            path.append(contentsOf: step.track)
            ends.append(path.count)
        }
        self.path = path
        self.pathEnds = ends
        self.glides = Self.glides(steps)
    }

    /// The step on screen `seconds` into the replay.
    public func stepIndex(atWallSeconds seconds: Double) -> Int {
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return min(steps.count - 1, Int((seconds / Self.stepSeconds).rounded(.down)))
    }

    public func pings(through index: Int) -> [DemoRacePing] {
        steps.prefix(index + 1).flatMap(\.pings)
    }

    /// The runner's path served by step `index`, oldest first: every ping so far and the points
    /// along the course line between them.
    public func track(through index: Int) -> ArraySlice<DemoRaceTrackPoint> {
        guard index >= 0, !pathEnds.isEmpty else { return path[0..<0] }
        return path[0..<pathEnds[min(index, pathEnds.count - 1)]]
    }

    /// Where the runner's dot is `seconds` of wall time into the replay. When a step brings pings
    /// the dot glides along the course line, never a chord, from the latest ping before it to the
    /// newest, at an even pace over `glideSeconds` (less when the next update comes sooner).
    /// Between updates it holds on the latest ping, so it never moves backwards and stands still
    /// through the dead zone. `throughStep`: the step the replay's routes answer, when the wall
    /// clock is already past it; the dot then waits on that step's newest ping instead of starting
    /// on pings not yet served. Nil before the first ping.
    public func runnerPosition(atWallSeconds seconds: Double, throughStep served: Int? = nil) -> DemoRaceRunnerPosition? {
        let wall = seconds.isFinite ? min(max(seconds, 0), Self.durationSeconds) : 0
        var step = stepIndex(atWallSeconds: wall)
        if let served {
            // A glide ends before the next update starts, so holding the served step's glide at
            // this wall time leaves the dot on its newest ping.
            step = min(step, max(0, served))
        }
        guard let glide = glides.last(where: { $0.stepIndex <= step }),
              let from = glide.path.first, let to = glide.path.last else { return nil }
        let share = glide.seconds > 0 ? min(max((wall - glide.wallOffsetSeconds) / glide.seconds, 0), 1) : 1
        let meters = share >= 1 ? to.lineMeters : from.lineMeters + (to.lineMeters - from.lineMeters) * share
        let at = share >= 1 ? to.recordedAt : share <= 0 ? from.recordedAt : Self.recordedAt(atLineMeters: meters, along: glide.path)
        let point = course.position(atLineMeters: meters)
        return DemoRaceRunnerPosition(
            latitude: point.latitude, longitude: point.longitude, lineMeters: meters,
            recordedAt: at, fromRecordedAt: from.recordedAt
        )
    }

    public func chat(through index: Int) -> [DemoRaceChatMessage] {
        steps.prefix(index + 1).flatMap(\.chat)
    }

    private static func build(_ course: DemoRaceCourse) -> [DemoRaceStep] {
        let total = course.plannedFinishSeconds
        let start = course.raceStart
        let planFinish = start.addingTimeInterval(total)
        // Between pings Last update ages at most 5 minutes, and always less than the ping spacing.
        let age = min(300, total / 100)
        var steps: [DemoRaceStep] = []
        var count = 0
        func ping(_ fraction: Double, _ at: Date, received: Date? = nil) -> DemoRacePing {
            count += 1
            let f = min(max(fraction, 0), 0.99)
            let meters = f * course.lineLengthMeters
            let point = course.position(atLineMeters: meters)
            return DemoRacePing(
                pingId: "demo-ping-\(count)", latitude: point.latitude, longitude: point.longitude,
                recordedAt: at, receivedAt: received ?? at, progressMeters: f * course.courseLengthMeters,
                lineMeters: meters
            )
        }
        func add(_ beat: DemoRaceBeat, _ now: Date, finish: Date, pings: [DemoRacePing] = [], chat: [DemoRaceChatMessage] = []) {
            steps.append(DemoRaceStep(
                index: steps.count, wallOffsetSeconds: Double(steps.count) * stepSeconds, beat: beat,
                now: now, pings: pings, finishEtaAt: finish, chat: chat
            ))
        }

        for k in 0..<10 {
            let fraction = 0.04 * Double(k)
            let at = start.addingTimeInterval(fraction * total)
            add(.following, at, finish: planFinish, pings: [ping(fraction, at)])
            add(.following, at.addingTimeInterval(age), finish: planFinish)
        }

        var last = start
        for (fraction, delay) in [(0.40, 240.0), (0.42, 480.0), (0.44, 720.0), (0.46, 720.0)] {
            let at = start.addingTimeInterval(fraction * total + delay)
            let finish = planFinish.addingTimeInterval(delay)
            add(.fallingBehind, at, finish: finish, pings: [ping(fraction, at)])
            add(.fallingBehind, at.addingTimeInterval(age), finish: finish)
            last = at
        }

        let delay = finishDelaySeconds
        let finish = planFinish.addingTimeInterval(delay)
        for i in 1...9 {
            add(.deadZone, last.addingTimeInterval(age + (deadZoneSeconds - age) * Double(i) / 9), finish: finish)
        }
        let arrival = last.addingTimeInterval(deadZoneSeconds)
        add(.deadZone, arrival, finish: finish)
        add(.deadZone, arrival, finish: finish)
        // On plan pace again, still 12 minutes down: the phone kept a sample every 3 minutes.
        let backlog = (1...6).map { minutes -> DemoRacePing in
            let at = last.addingTimeInterval(Double(minutes) * 180)
            return ping((at.timeIntervalSince(start) - delay) / total, at, received: arrival)
        }
        add(.deadZone, arrival, finish: finish, pings: backlog)

        let resumed = (arrival.timeIntervalSince(start) - delay) / total
        for j in 1...5 {
            let fraction = resumed + 0.02 * Double(j)
            let at = start.addingTimeInterval(delay + fraction * total)
            let chat = j == 3
                ? [DemoRaceChatMessage(seq: 1, senderUserId: crewUserId, text: crewMessage, createdAt: at)]
                : []
            add(.crewChat, at, finish: finish, pings: [ping(fraction, at)], chat: chat)
            add(.crewChat, at.addingTimeInterval(age), finish: finish)
        }
        return steps
    }

    /// Fills each step's `track`: for every ping, the course line since the ping before it
    /// (`between`), then the ping itself.
    private static func densify(_ steps: [DemoRaceStep], course: DemoRaceCourse) -> [DemoRaceStep] {
        let wire = WireTime()
        var previous: DemoRacePing?
        var filled: [DemoRaceStep] = []
        for var step in steps {
            var track: [DemoRaceTrackPoint] = []
            for ping in step.pings {
                if let previous {
                    track.append(contentsOf: between(previous, ping, course: course, wire: wire))
                }
                track.append(DemoRaceTrackPoint(
                    recordedAt: ping.recordedAt, latitude: ping.latitude, longitude: ping.longitude, lineMeters: ping.lineMeters
                ))
                previous = ping
            }
            step.track = track
            filled.append(step)
        }
        return filled
    }

    /// The course line strictly between two pings: the line's own vertices there, and evenly
    /// spaced points wherever two neighbours would be more than `trackSpacingMeters` apart along
    /// it. Times run evenly by distance from one ping's time to the other's, each the exact time
    /// its wire string reads back as, so the track cursor compares them as the client does.
    ///
    /// Two points can't share a wire millisecond (the cursor would skip one). Where a point's
    /// millisecond is already taken, a vertex wins over a spacing point: a vertex takes the place
    /// of the spacing point before it, at that point's time, since leaving out a vertex would cut
    /// a chord across its bend; a spacing point is left out. Only a vertex within a millisecond of
    /// another vertex or of a ping is lost, a few millimetres of course at running pace.
    static func between(_ a: DemoRacePing, _ b: DemoRacePing, course: DemoRaceCourse, wire: WireTime) -> [DemoRaceTrackPoint] {
        let start = a.lineMeters
        let end = b.lineMeters
        let from = a.recordedAt.timeIntervalSince1970
        let until = b.recordedAt.timeIntervalSince1970
        guard end > start, until > from else { return [] }
        var marks: [(meters: Double, vertex: Bool)] = []
        var last = start
        for mark in course.vertexMeters.filter({ $0 > start && $0 < end }) + [end] {
            let gap = mark - last
            let pieces = Int((gap / trackSpacingMeters).rounded(.up))
            if pieces > 1 {
                for piece in 1..<pieces {
                    marks.append((last + gap * Double(piece) / Double(pieces), false))
                }
            }
            if mark < end {
                marks.append((mark, true))
            }
            last = mark
        }
        var points: [DemoRaceTrackPoint] = []
        // Whether each of `points` is a vertex of the line.
        var vertices: [Bool] = []
        var taken = wire.time(a.recordedAt)
        let limit = wire.time(b.recordedAt)
        for (meters, vertex) in marks {
            let time = wire.time(Date(timeIntervalSince1970: from + (until - from) * (meters - start) / (end - start)))
            let point = course.position(atLineMeters: meters)
            if time > taken, time < limit {
                points.append(DemoRaceTrackPoint(recordedAt: time, latitude: point.latitude, longitude: point.longitude, lineMeters: meters))
                vertices.append(vertex)
                taken = time
            } else if vertex, let previous = points.last, vertices.last == false {
                // Its millisecond is taken (or is the next ping's): it replaces the spacing point
                // before it, keeping that point's time, so times stay in order.
                points[points.count - 1] = DemoRaceTrackPoint(
                    recordedAt: previous.recordedAt, latitude: point.latitude, longitude: point.longitude, lineMeters: meters
                )
                vertices[vertices.count - 1] = true
            }
        }
        return points
    }

    /// Every step that brings pings, in order, with its glide: from the latest ping before it,
    /// along the path the step serves, over `glideSeconds` or until the next such step. The first
    /// has nowhere to glide from, so its dot starts on its ping.
    private static func glides(_ steps: [DemoRaceStep]) -> [DemoRaceGlide] {
        let updates = steps.filter { !$0.track.isEmpty }
        var glides: [DemoRaceGlide] = []
        var previous: DemoRaceTrackPoint?
        for (offset, step) in updates.enumerated() {
            let next = offset + 1 < updates.count ? updates[offset + 1].wallOffsetSeconds : durationSeconds
            let seconds = previous == nil ? 0 : max(0, min(glideSeconds, next - step.wallOffsetSeconds))
            glides.append(DemoRaceGlide(
                stepIndex: step.index, wallOffsetSeconds: step.wallOffsetSeconds, seconds: seconds,
                path: (previous.map { [$0] } ?? []) + step.track
            ))
            previous = step.track.last
        }
        return glides
    }

    /// When `path` (oldest first, never backwards along the line) reaches `meters`: between the
    /// two points either side, by distance, so every point recorded at or before the answer is at
    /// or behind `meters`. Where the path stands still at `meters`, the last point there.
    static func recordedAt(atLineMeters meters: Double, along path: [DemoRaceTrackPoint]) -> Date {
        guard let first = path.first, let last = path.last else { return .distantPast }
        if meters >= last.lineMeters { return last.recordedAt }
        if meters < first.lineMeters { return first.recordedAt }
        // The last point at or behind `meters`; the one after it is ahead.
        var low = 0
        var high = path.count - 1
        while low < high {
            let middle = (low + high + 1) / 2
            if path[middle].lineMeters <= meters { low = middle } else { high = middle - 1 }
        }
        let a = path[low]
        let b = path[min(low + 1, path.count - 1)]
        let span = b.lineMeters - a.lineMeters
        guard span > 0 else { return a.recordedAt }
        return a.recordedAt.addingTimeInterval(b.recordedAt.timeIntervalSince(a.recordedAt) * ((meters - a.lineMeters) / span))
    }
}

/// A time as the replay's routes send it and the client reads it back: `RaceDayReadouts.iso8601`
/// (milliseconds) then `ScheduleFormat.parseISO8601`, with one pair of formatters for a whole
/// script build instead of two per point.
struct WireTime {
    private let format: ISO8601DateFormatter
    private let parse: ISO8601DateFormatter

    init() {
        format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        format.timeZone = TimeZone(secondsFromGMT: 0)
        parse = ISO8601DateFormatter()
        parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func time(_ date: Date) -> Date {
        parse.date(from: format.string(from: date)) ?? date
    }
}

/// One step that brings pings, as the dot plays it out (`DemoRaceScript.runnerPosition`).
struct DemoRaceGlide: Equatable, Sendable {
    var stepIndex: Int
    var wallOffsetSeconds: Double
    /// How long the dot takes to reach the step's newest ping; 0 for the very first.
    var seconds: Double
    /// The latest ping before the step (none for the first), then the path the step serves.
    var path: [DemoRaceTrackPoint]
}
