import Foundation

/// A runner's unpaid race in the `GET /race-rooms/:roomId` shape, so the
/// `crewcue://dev/onboarding-race-preview` replay plays without an API (deeplink smoke tests and
/// device proofs). Never shown in the product flow, which builds the replay from the runner's own
/// room. Its times match `ScheduleFixture`: the start at 13:00Z and the finish 21 000 s later.
public enum DemoRaceFixture {
    public static let roomId = "room-fixture-replay"
    public static let runnerUserId = "runner-fixture"
    public static let raceName = "Fixture 50K"

    /// The room body, the way `RaceDayAPI.loadRoomData` returns it.
    public static var roomData: Data {
        (try? JSONSerialization.data(withJSONObject: roomObject, options: [.sortedKeys])) ?? Data()
    }

    static let raceStartAt = "2026-08-15T13:00:00.000Z"
    static let finishAt = "2026-08-15T18:50:00.000Z"
    static let finishElapsedSeconds = 21_000.0
    static let courseLengthMeters = 50_000.0

    /// The course line, `[longitude, latitude]`, through every checkpoint.
    static let line: [[Double]] = [
        [-106.2925, 39.2508], [-106.3100, 39.2650], [-106.3300, 39.2900], [-106.3550, 39.3050],
        [-106.3800, 39.3250], [-106.3600, 39.3500], [-106.3350, 39.3700], [-106.3100, 39.3850],
        [-106.2900, 39.4000]
    ]

    static var roomObject: [String: Any] {
        let checkpoints: [[String: Any]] = [
            checkpoint("start", "Start", line[0], 0, stop: 0),
            checkpoint("aid-1", "Aid 1", line[2], 12_000, stop: 300),
            checkpoint("aid-2", "Aid 2", line[4], 25_000, stop: 600),
            checkpoint("aid-3", "Aid 3", line[6], 38_000, stop: 300),
            checkpoint("finish", "Finish", line[8], courseLengthMeters, stop: 0)
        ]
        let room: [String: Any] = [
            "id": roomId,
            "teamId": "team-fixture",
            "athleteId": runnerUserId,
            "name": raceName,
            "status": "active",
            "createdAt": "2026-08-01T00:00:00.000Z",
            "raceStartAt": raceStartAt,
            "memberships": [
                ["userId": runnerUserId, "role": "athlete", "joinedAt": "2026-08-01T00:00:00.000Z", "displayName": "Ada"]
            ],
            "entitlement": ["status": "unpaid", "lastUpdatedAt": "2026-08-01T00:00:00.000Z", "source": "none"],
            "course": ["checkpoints": checkpoints],
            "courseDistanceMeters": courseLengthMeters,
            "courseFileName": "fixture-50k.gpx",
            "plannedPaceSecondsPerKm": finishElapsedSeconds / (courseLengthMeters / 1000),
            "pacingEstimateId": "est-fixture",
            "pacingEstimate": [
                "id": "est-fixture", "coldStart": true, "expectedFinishAt": finishAt,
                "expectedFinishElapsedSeconds": finishElapsedSeconds, "aidEtas": [Any](),
                "explanation": "Finish-only teaser"
            ],
            "mapWorkspace": [
                "drivesProjectionLayerId": "course",
                "layers": [["id": "course", "geometry": ["type": "LineString", "coordinates": line]]]
            ]
        ]
        return ["room": room, "permissions": ["canEditCourse": true]]
    }

    private static func checkpoint(_ id: String, _ title: String, _ point: [Double], _ meters: Double, stop: Double) -> [String: Any] {
        [
            "id": id, "title": title, "latitude": point[1], "longitude": point[0],
            "distanceMetersFromStart": meters, "plannedStopSeconds": stop
        ]
    }
}
