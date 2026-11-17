import Foundation
import CrewCueClientCore

/// Where a screen model keeps its per-user and per-race files (tracking session, schedule cache,
/// course map, estimate history). The app's storage by default; the onboarding replay gives its
/// models the `DemoRaceSession` directories instead, so the replay's schedule, course map and
/// estimate never land in the real `users/<id>/rooms/<roomId>` (it reuses the real room id).
@MainActor
struct ModelStorage {
    var userDirectory: @MainActor (_ userId: String) throws -> URL
    var roomDirectory: @MainActor (_ userId: String, _ roomId: String) throws -> URL

    /// `AppDirectories`: the signed-in user's storage, wiped on sign-out.
    static var app: ModelStorage {
        ModelStorage(
            userDirectory: { try AppDirectories.userDirectory(userId: $0) },
            roomDirectory: { try AppDirectories.roomDirectory(userId: $0, roomId: $1) }
        )
    }

    /// The replay's temporary directory. Once the replay ends both throw, so a late write can't
    /// recreate the directory the replay deleted.
    static func replay(_ session: DemoRaceSession) -> ModelStorage {
        ModelStorage(
            userDirectory: { try session.userDirectory(userId: $0) },
            roomDirectory: { try session.roomDirectory(userId: $0, roomId: $1) }
        )
    }
}
