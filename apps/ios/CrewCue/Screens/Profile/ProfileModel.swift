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
    /// The race the owner asked to delete, waiting on the confirm dialog. Lives here, not in view
    /// state, so a size change or fold keeps the dialog's race.
    var pendingDelete: RaceSummary?
    private(set) var deletingRaceId: String?
    /// Shown under Your races. Kept apart from `message`, which a race switch resets.
    private(set) var deleteMessage = ""

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

    func confirmDelete(_ race: RaceSummary) {
        guard deletingRaceId == nil else { return }
        deleteMessage = ""
        pendingDelete = race
    }

    /// Deletes the race the dialog confirmed, for the whole crew. Takes the race from the dialog,
    /// since dismissing it clears `pendingDelete`. `onDeleted` runs only once the server says it
    /// is gone, so a failure leaves the race listed and active.
    func delete(_ race: RaceSummary, onDeleted: @escaping @MainActor (String) -> Void) async {
        guard deletingRaceId == nil else { return }
        pendingDelete = nil
        deletingRaceId = race.id
        defer { deletingRaceId = nil }
        switch await RaceDeletion.run(graph: client.graph, roomId: race.id) {
        case .deleted:
            deleteMessage = RaceDeletion.deletedMessage
            onDeleted(race.id)
        case .failed(let failure):
            deleteMessage = failure
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
        pendingDelete = nil
        deleteMessage = ""
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
