import Foundation
import CrewCueClientCore

@MainActor
enum AppDirectories {
    static func root() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("crewcue", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    static func userDirectory(userId: String) throws -> URL {
        let safe = userId
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        let directory = try root().appendingPathComponent(safe, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Schedule cache, estimate, course draft, and course map for one race.
    static func roomDirectory(userId: String, roomId: String) throws -> URL {
        let directory = RoomStorage.directory(userDirectory: try userDirectory(userId: userId), roomId: roomId)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    static func athleteDraftURL() throws -> URL {
        try root().appendingPathComponent("athlete-draft.json")
    }
}
