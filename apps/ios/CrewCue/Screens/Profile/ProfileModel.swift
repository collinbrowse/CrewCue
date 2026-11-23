import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class ProfileModel {
    private(set) var displayName = ""
    private(set) var message = ""
    private(set) var showsName = false
    var raceName = ""
    private(set) var creatingRace = false
    /// The rename alert: open, its draft, and a save in flight. Kept here so a fold or rotation
    /// keeps the typed name.
    var showsRename = false
    var renameDraft = ""
    private(set) var renaming = false

    private let client: AppClient
    private var onSignOut: @MainActor () -> Void
    private var onDisplayName: (@MainActor (String) -> Void)?
    private var generation = 0
    private var userId: String?
    private var roomId: String?

    init(client: AppClient) {
        self.client = client
        self.onSignOut = {}
    }

    func bindSignOut(_ action: @escaping @MainActor () -> Void) {
        onSignOut = action
    }

    func signOut() {
        onSignOut()
    }

    func createRace(onCreated: @escaping @MainActor (String) -> Void) async {
        let name = raceName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            message = "Enter a race name."
            return
        }
        guard let userId, !creatingRace else {
            if userId == nil { message = "Couldn't create the race." }
            return
        }
        creatingRace = true
        defer { creatingRace = false }
        do {
            let room = try await RaceDayAPI.createRoom(
                graph: client.graph,
                name: name,
                athleteId: userId,
                teamId: userId,
                creatorName: displayName.isEmpty ? nil : displayName
            )
            raceName = ""
            message = "Race created."
            onCreated(room.id)
        } catch {
            message = APIFailure.isOffline(error) ? "Offline. Profile not updated." : "Couldn't create the race."
        }
    }

    /// The active room's name as Profile last loaded it: the rename draft before the race list loads.
    private var loadedRoomName = ""

    /// Opens the rename alert with the race's current name.
    func beginRename(currentName: String) {
        renameDraft = currentName.isEmpty ? loadedRoomName : currentName
        showsRename = true
    }

    /// `PATCH /race-rooms/:roomId` through client-core. Open on a locked race too.
    func renameRace(onRenamed: @escaping @MainActor (String, String) -> Void) async {
        guard let roomId, !renaming else { return }
        guard RaceName.validated(renameDraft) != nil else {
            message = RaceName.invalidMessage
            return
        }
        renaming = true
        defer { renaming = false }
        do {
            let room = try await RaceDayAPI.renameRace(graph: client.graph, roomId: roomId, name: renameDraft)
            guard roomId == self.roomId else { return }
            message = RaceRenameCopy.saved
            loadedRoomName = room.name
            onRenamed(room.id, room.name)
        } catch {
            message = RaceRenameCopy.message(for: error)
        }
    }

    func activate(
        userId: String?,
        roomId: String?,
        displayName: String?,
        onName: @escaping @MainActor (String) -> Void
    ) async {
        generation += 1
        let ticket = generation
        onDisplayName = onName
        self.userId = Self.trimmed(userId)
        self.roomId = Self.trimmed(roomId)
        let sessionName = Self.trimmed(displayName)
        guard let roomId = self.roomId else {
            applyName(sessionName)
            return
        }
        do {
            let envelope = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId)
            guard ticket == generation, !Task.isCancelled else { return }
            loadedRoomName = envelope.room.name
            let remoteName = Self.trimmed(envelope.room.memberships.first { $0.userId == self.userId }?.displayName)
            if sessionName == nil, let remoteName {
                applyName(remoteName)
                onDisplayName?(remoteName)
            } else {
                applyName(sessionName)
            }
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            showsName = false
            self.displayName = ""
            message = APIFailure.isOffline(error) ? "Offline. Profile not updated." : "Couldn't load profile."
        }
    }

    func clear() {
        generation += 1
        displayName = ""
        message = ""
        showsName = false
        userId = nil
        roomId = nil
        showsRename = false
        renameDraft = ""
        loadedRoomName = ""
    }

    private func applyName(_ name: String?) {
        if let name {
            displayName = name
            showsName = true
            message = ""
        } else {
            displayName = ""
            showsName = false
            message = "Display name is empty."
        }
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}
