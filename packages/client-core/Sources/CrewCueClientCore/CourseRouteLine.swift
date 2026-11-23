import Foundation

/// The course line saved with the race: the GPX the runner uploaded, as the server simplified it
/// into the room's `mapWorkspace`. The race map draws it instead of joining the checkpoints.
public enum CourseRouteLine {
    /// The line in a `GET /race-rooms/:roomId` body. Empty when the room has no saved line (fewer
    /// than two usable vertices); the map then joins the checkpoints.
    public static func points(roomData data: Data) -> [CourseRoutePoint] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let room = root["room"] as? [String: Any] else {
            return []
        }
        let line = CoursePayload.routeVertices(room: room).compactMap { vertex -> CourseRoutePoint? in
            guard vertex.latitude.isFinite, vertex.longitude.isFinite,
                  (-90...90).contains(vertex.latitude), (-180...180).contains(vertex.longitude) else {
                return nil
            }
            return CourseRoutePoint(
                latitude: vertex.latitude,
                longitude: vertex.longitude,
                elevationMeters: vertex.elevation.flatMap { $0.isFinite ? $0 : nil }
            )
        }
        return line.count >= 2 ? line : []
    }
}
