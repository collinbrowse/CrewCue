import Foundation
import CrewCueClientCore

@MainActor
enum AppDirectories {
    private static let rootName = "crewcue"

    static func root() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent(rootName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Per-user files live under `root/users/<id>` so they can be listed and wiped together.
    static func userStorage() throws -> UserStorage {
        UserStorage(root: try root())
    }

    static func userDirectory(userId: String) throws -> URL {
        try userStorage().directory(userId: userId)
    }

    /// Builds before #538 kept each user's files directly under the root. Those directories can't
    /// be told apart from another account's, so they are removed on sign-in.
    static func removeLegacyUserDirectories() throws {
        let root = try root()
        let keep = UserStorage(root: root).usersDirectory.lastPathComponent
        for name in try FileManager.default.contentsOfDirectory(atPath: root.path) where name != keep {
            var isDirectory: ObjCBool = false
            let url = root.appendingPathComponent(name, isDirectory: true)
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    /// Schedule cache, estimate, course draft, and course map for one race.
    static func roomDirectory(userId: String, roomId: String) throws -> URL {
        let directory = RoomStorage.directory(userDirectory: try userDirectory(userId: userId), roomId: roomId)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Where `roomDirectory` keeps one race's files, built without creating any directory, so
    /// removing a file there never brings back a user's directory a wipe already took.
    static func roomLocation(userId: String, roomId: String) -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let storage = UserStorage(root: base.appendingPathComponent(rootName, isDirectory: true))
        return RoomStorage.directory(userDirectory: storage.location(userId: userId), roomId: roomId)
    }

    /// Onboarding progress, beside the root so sign-out's wipe never reaches it.
    static func onboardingStore() throws -> OnboardingStore {
        OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: try root()))
    }

    static func athleteDraftURL() throws -> URL {
        try root().appendingPathComponent("athlete-draft.json")
    }
}
