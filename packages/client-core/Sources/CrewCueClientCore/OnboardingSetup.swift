import Foundation

/// One vertex of the course line the server built from the runner's GPX (`gpx-preview`).
public struct CourseRoutePoint: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var elevationMeters: Double?

    public init(latitude: Double, longitude: Double, elevationMeters: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.elevationMeters = elevationMeters
    }
}

/// `POST /race-rooms/:roomId/course/gpx-preview`: the course the server read from a GPX, before
/// anything is saved. The route line is the server's (simplified) GeoJSON; the client only reads it.
public struct CoursePreview: Codable, Equatable, Sendable {
    public var courseFileName: String
    public var checkpoints: [RaceCourseCheckpoint]
    public var plannedPaceSecondsPerKm: Double?
    public var route: [CourseRoutePoint]

    public init(courseFileName: String, checkpoints: [RaceCourseCheckpoint], plannedPaceSecondsPerKm: Double?, route: [CourseRoutePoint]) {
        self.courseFileName = courseFileName
        self.checkpoints = checkpoints
        self.plannedPaceSecondsPerKm = plannedPaceSecondsPerKm
        self.route = route
    }

    /// Reads the preview body. Throws when it has no course with at least one checkpoint.
    public init(previewData data: Data, fileName: String) throws {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let course = root["course"] as? [String: Any],
              let rawCheckpoints = course["checkpoints"] else {
            throw ClientHTTPError(status: 0, message: "Couldn't read the route file.")
        }
        let checkpointData = try JSONSerialization.data(withJSONObject: rawCheckpoints)
        let checkpoints = try JSONDecoder().decode([RaceCourseCheckpoint].self, from: checkpointData)
        guard !checkpoints.isEmpty else { throw ClientHTTPError(status: 0, message: "Couldn't read the route file.") }
        let layer = root["routeOverlayLayer"] as? [String: Any]
        let geometry = layer?["geometry"] as? [String: Any]
        let coordinates = (geometry?["coordinates"] as? [Any]) ?? []
        let route: [CourseRoutePoint] = coordinates.compactMap { value in
            guard let pair = value as? [Any], pair.count >= 2,
                  let longitude = JSONNumber.double(pair[0]), let latitude = JSONNumber.double(pair[1]),
                  latitude.isFinite, longitude.isFinite else { return nil }
            let elevation = pair.count >= 3 ? JSONNumber.double(pair[2]).flatMap { $0.isFinite ? $0 : nil } : nil
            return CourseRoutePoint(latitude: latitude, longitude: longitude, elevationMeters: elevation)
        }
        let pace = JSONNumber.double(root["plannedPaceSecondsPerKm"]).flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
        let name = (root["courseFileName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? fileName
        self.init(courseFileName: name, checkpoints: checkpoints, plannedPaceSecondsPerKm: pace, route: route)
    }

    /// Length along the route line, else along the checkpoints when the preview has no line.
    public var lengthMeters: Double {
        let line = route.count >= 2
            ? route.map { ($0.latitude, $0.longitude) }
            : checkpoints.map { ($0.latitude, $0.longitude) }
        return zip(line, line.dropFirst()).reduce(0) { $0 + Geodesy.meters($1.0, $1.1) }
    }

    /// The elevation profile along the route line (an unpaid race's room has no `baselineTrack`).
    public var elevation: ElevationProfile? {
        ElevationProfile(route: route)
    }
}

extension ElevationProfile {
    /// Distance along the line against elevation, for every vertex that has one. Nil when fewer
    /// than two vertices carry an elevation.
    public init?(route: [CourseRoutePoint]) {
        var distance = 0.0
        var samples: [(distanceMeters: Double, elevationMeters: Double)] = []
        for (index, point) in route.enumerated() {
            if index > 0 {
                let previous = route[index - 1]
                distance += Geodesy.meters((previous.latitude, previous.longitude), (point.latitude, point.longitude))
            }
            if let elevation = point.elevationMeters, elevation.isFinite {
                samples.append((distance, elevation))
            }
        }
        guard samples.count >= 2 else { return nil }
        self.init(samples: samples)
    }
}

enum Geodesy {
    /// Great-circle distance in meters.
    static func meters(_ a: (Double, Double), _ b: (Double, Double)) -> Double {
        let radius = 6_371_000.0
        let p1 = a.0 * .pi / 180
        let p2 = b.0 * .pi / 180
        let dLat = (b.0 - a.0) * .pi / 180
        let dLon = (b.1 - a.1) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(p1) * cos(p2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * radius * asin(min(1, sqrt(h)))
    }
}

/// What the runner's projection teaser shows on an unpaid race: the finish ETA and which
/// checkpoints stay locked. The server withholds every ETA between the start and the finish and
/// names those checkpoints in `locked` on the schedule and the projection. Pure.
public struct OnboardingTeaser: Equatable, Sendable {
    /// ISO 8601 UTC. The schedule's finish row, else the projection's start-line finish, else the
    /// attached estimate's: the header and the timeline's finish row then read the same instant.
    public var finishAt: String?
    /// The schedule's locked checkpoints, then any only the projection names, in that order.
    public var lockedCheckpointIds: [String]

    public init(sheet: CrewScheduleSheet?, projection: RaceRoomProjectionCore?, estimate: PacingEstimate?) {
        let finishRow = (sheet?.stops.count ?? 0) >= 2 ? sheet?.stops.last?.clockArrivalAt : nil
        let candidates = [finishRow, projection?.etaFinishPlanIso, estimate?.expectedFinishAt]
        finishAt = candidates.compactMap { value -> String? in
            guard let value, ScheduleFormat.parseISO8601(value) != nil else { return nil }
            return value
        }.first
        var locked: [String] = []
        for id in (sheet?.locked?.checkpointIds ?? []) + (projection?.locked?.checkpointIds ?? []) where !locked.contains(id) {
            locked.append(id)
        }
        lockedCheckpointIds = locked
    }
}

/// How a runner setup step failed, and what the step shows for it.
public enum OnboardingSetupFailure: String, Equatable, Sendable {
    /// No network. The step and everything typed or picked stay; the person continues later.
    case offline
    /// 429 on a course save (unpaid races are capped per hour).
    case courseSaveLimit
    /// 402 `room_unpaid`: a crew feature of a race that isn't unlocked. The app opens the paywall.
    case raceLocked
    /// Anything else.
    case failed

    /// `courseSave`: the request was a course save (`gpx-preview` or `PUT course`), the only kind
    /// whose 429 has its own copy. Another 429 is a plain failure.
    public static func classify(_ error: any Error, courseSave: Bool = false) -> OnboardingSetupFailure {
        if TransportFailure.isOffline(error) { return .offline }
        guard let http = error as? ClientHTTPError else { return .failed }
        if http.status == 429, courseSave { return .courseSaveLimit }
        if http.status == 402, http.reason == "room_unpaid" || http.decision == "room_unpaid" { return .raceLocked }
        return .failed
    }

    /// Shown under the step.
    public var message: String {
        switch self {
        case .offline: CrewCueClientCore.featureScreen(id: "onboarding-runner-setup", state: .offline).body
        case .courseSaveLimit: OnboardingCopy.courseSaveLimit
        case .raceLocked: OnboardingCopy.explanation(for: .paywall) ?? ""
        case .failed: CrewCueClientCore.featureScreen(id: "onboarding-runner-setup", state: .error).body
        }
    }

    public var opensPaywall: Bool { self == .raceLocked }
}

extension RaceDayAPI {
    /// `POST /race-rooms/:roomId/course/gpx-preview`. Saves nothing.
    public static func previewGpx(graph: ClientGraph, roomId: String, fileName: String, gpxXml: String) async throws -> CoursePreview {
        let data = try await sendData(
            graph,
            "/race-rooms/\(roomId)/course/gpx-preview",
            method: .post,
            body: String(decoding: try JSONSerialization.data(withJSONObject: ["gpxXml": gpxXml, "courseFileName": fileName]), as: UTF8.self)
        )
        return try CoursePreview(previewData: data, fileName: fileName)
    }

    /// `GET /race-rooms/:roomId/projection` as the server sends it, `locked` included (an unpaid
    /// race's teaser). Nil when the room has no projection yet (404).
    public static func projectionCore(graph: ClientGraph, roomId: String) async throws -> RaceRoomProjectionCore? {
        do {
            let data = try await sendData(graph, "/race-rooms/\(roomId)/projection", method: .get, body: nil)
            return try JSONDecoder().decode(RaceRoomProjectionCore.self, from: data)
        } catch let error as ClientHTTPError where error.status == 404 {
            return nil
        }
    }
}
