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

    /// The point `fraction` of the way along the course line.
    public func position(atFraction fraction: Double) -> DemoRaceCoordinate {
        let total = cumulativeMeters.last ?? 0
        guard total > 0, let first = line.first else { return line.first ?? DemoRaceCoordinate(latitude: 0, longitude: 0) }
        let target = min(max(fraction, 0), 1) * total
        guard let upper = cumulativeMeters.firstIndex(where: { $0 >= target }), upper > 0 else { return first }
        let span = cumulativeMeters[upper] - cumulativeMeters[upper - 1]
        let t = span > 0 ? (target - cumulativeMeters[upper - 1]) / span : 0
        let a = line[upper - 1], b = line[upper]
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

    public var caption: String {
        switch self {
        case .following: "Each ping from your phone moves you on your crew's map and resets Last update."
        case .fallingBehind: "You slow down, and your finish ETA moves later on every crew phone."
        case .deadZone: "No signal. Crew see how long ago your last ping was, then your saved pings arrive together."
        case .crewChat: "Your crew can message you in the race chat."
        }
    }
}

public struct DemoRacePing: Equatable, Sendable {
    public var pingId: String
    public var latitude: Double
    public var longitude: Double
    public var recordedAt: Date
    public var receivedAt: Date
    public var progressMeters: Double
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

    public let course: DemoRaceCourse
    public let steps: [DemoRaceStep]

    public init(course: DemoRaceCourse) {
        self.course = course
        self.steps = Self.build(course)
    }

    /// The step on screen `seconds` into the replay.
    public func stepIndex(atWallSeconds seconds: Double) -> Int {
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return min(steps.count - 1, Int((seconds / Self.stepSeconds).rounded(.down)))
    }

    public func pings(through index: Int) -> [DemoRacePing] {
        steps.prefix(index + 1).flatMap(\.pings)
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
            let point = course.position(atFraction: f)
            return DemoRacePing(
                pingId: "demo-ping-\(count)", latitude: point.latitude, longitude: point.longitude,
                recordedAt: at, receivedAt: received ?? at, progressMeters: f * course.courseLengthMeters
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
}
