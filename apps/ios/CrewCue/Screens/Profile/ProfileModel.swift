import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class ProfileModel {
    private(set) var displayName = ""
    private(set) var message = ""
    private(set) var showsName = false

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
