import Foundation

/// Whether a pin dropped on the race map may become a checkpoint: it has to sit on the course.
/// The server projects every checkpoint onto the route line, so a pin far off the line would be
/// counted at the nearest point of a route the runner never leaves, with a made-up distance.
public enum CheckpointPlacement {
    /// How far off the route line a pin may sit. The same reach the GPX import gives a waypoint
    /// to count as on the track (map-core `WAYPOINT_APPROACH_MAX_DISTANCE_METERS`, 155 m).
    public static let maxOffCourseMeters = 155.0

    public static let tooFarMessage = "Too far from the course to add a stop. Drop it on the route."

    /// The pin's distance to the nearest point of the route line. Nil without a line (fewer than
    /// two vertices) or for an unreadable position.
    public static func offCourseMeters(latitude: Double, longitude: Double, route: [CourseRoutePoint]) -> Double? {
        guard latitude.isFinite, longitude.isFinite, route.count >= 2 else { return nil }
        // Local flat projection around the pin: meters east and north. Plenty for a 155 m test.
        let metersPerDegree = 111_320.0
        let east = cos(latitude * .pi / 180) * metersPerDegree
        func local(_ point: CourseRoutePoint) -> (x: Double, y: Double) {
            ((point.longitude - longitude) * east, (point.latitude - latitude) * metersPerDegree)
        }
        var best = Double.infinity
        for (a, b) in zip(route, route.dropFirst()) {
            let p = local(a)
            let q = local(b)
            let dx = q.x - p.x
            let dy = q.y - p.y
            let length = dx * dx + dy * dy
            let t = length > 0 ? min(1, max(0, -(p.x * dx + p.y * dy) / length)) : 0
            let x = p.x + t * dx
            let y = p.y + t * dy
            best = min(best, (x * x + y * y).squareRoot())
        }
        return best.isFinite ? best : nil
    }

    /// Nil when the pin may be saved; else what to tell the person. A race with no route line
    /// can't be checked here, so the pin goes to the server, which decides.
    public static func rejection(latitude: Double, longitude: Double, route: [CourseRoutePoint]) -> String? {
        guard let meters = offCourseMeters(latitude: latitude, longitude: longitude, route: route) else { return nil }
        return meters > maxOffCourseMeters ? tooFarMessage : nil
    }
}
