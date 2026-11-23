import Foundation

/// The race lock (server `lib/raceLock.ts`). A Race Pass pays for one race: once the race is used
/// (the runner reaches the first aid station, or 48 hours after the start), its course line
/// and start time are locked. Renaming and aid-station edits stay open. The room carries the lock
/// as `raceLockedAt`; a refused edit answers 409 `{ code: "race_locked" }`.
public enum RaceLock {
    public static let code = "race_locked"
    public static let message = "Your race has started, so its course and start time are locked. You can still rename it and edit aid stations."

    /// The room's course and start are locked.
    public static func isLocked(_ room: RaceRoom) -> Bool {
        isLocked(raceLockedAt: room.raceLockedAt)
    }

    public static func isLocked(raceLockedAt: String?) -> Bool {
        (raceLockedAt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) == false
    }

    /// The server refused an edit because the race is locked.
    public static func isLockedError(_ error: any Error) -> Bool {
        guard let http = error as? ClientHTTPError, http.status == 409 else { return false }
        return http.reason == code || http.decision == code
    }
}

/// A race name as the server takes it: trimmed, 1 to 80 characters.
public enum RaceName {
    public static let maxLength = 80
    public static let invalidMessage = "Enter a race name of up to 80 characters."

    /// The trimmed name, or nil when it is empty or too long.
    public static func validated(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false, trimmed.count <= maxLength else { return nil }
        return trimmed
    }
}

/// What Profile says around a rename (clients/behavior/race-rename.md).
public enum RaceRenameCopy {
    public static let rowTitle = "Rename race"
    public static let rowDetail = "Change the name your crew sees"
    public static let saved = "Race renamed."
    public static let failed = "Couldn't rename the race."
    public static let offline = "Offline. Race name not changed."

    /// The line Profile shows after a failed rename.
    public static func message(for error: any Error) -> String {
        if TransportFailure.isOffline(error) { return offline }
        if let http = error as? ClientHTTPError, http.status == 400 { return RaceName.invalidMessage }
        return failed
    }
}

extension RaceDayAPI {
    /// `PATCH /race-rooms/:roomId`: rename the race. Open to race-setup editors, also on a locked
    /// race. Answers the room shaped for the caller. A name that is empty or over 80 characters
    /// throws a 400 without calling the server.
    public static func renameRace(graph: ClientGraph, roomId: String, name: String) async throws -> RaceRoom {
        guard let trimmed = RaceName.validated(name) else {
            throw ClientHTTPError(status: 400, message: RaceName.invalidMessage, bodyError: RaceName.invalidMessage)
        }
        let body = try JSONSerialization.data(withJSONObject: ["name": trimmed])
        let data = try await sendData(graph, "/race-rooms/\(roomId)", method: .patch, body: String(decoding: body, as: UTF8.self))
        return try JSONDecoder().decode(RaceRoom.self, from: data)
    }
}
