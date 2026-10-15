import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class ChatNotificationPrefsModel {
    private(set) var preference = "all"
    private(set) var message = ""
    private(set) var isWorking = false

    private let client: AppClient
    private var roomId: String?
    private var generation = 0

    init(client: AppClient) {
        self.client = client
    }

    func activate(roomId: String?) async {
        generation += 1
        let ticket = generation
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.roomId = trimmed.isEmpty ? nil : trimmed
        guard let roomId = self.roomId else {
            message = "Couldn't save alert settings."
            return
        }
        do {
            let pref = try await RaceDayAPI.notificationPreference(graph: client.graph, roomId: roomId)
            guard ticket == generation, !Task.isCancelled else { return }
            apply(pref.preference)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            message = APIFailure.isOffline(error)
                ? "Offline. Alert settings stay on this device."
                : "Couldn't save alert settings."
        }
    }

    func choose(_ value: String) async {
        guard !isWorking else { return }
        guard value == "all" || value == "mentions" || value == "none" else { return }
        preference = value
        guard let roomId else {
            message = "Couldn't save alert settings."
            return
        }
        let ticket = generation
        isWorking = true
        defer { isWorking = false }
        do {
            let saved = try await RaceDayAPI.saveNotificationPreference(
                graph: client.graph,
                roomId: roomId,
                preference: value
            )
            guard ticket == generation else { return }
            apply(saved.preference)
        } catch {
            guard ticket == generation else { return }
            message = APIFailure.isOffline(error)
                ? "Offline. Alert settings stay on this device."
                : "Couldn't save alert settings."
        }
    }

    func clear() {
        generation += 1
        preference = "all"
        message = ""
        roomId = nil
        isWorking = false
    }

    private func apply(_ value: String) {
        preference = value
        if value == "none" {
            message = "Alerts are off."
        } else {
            message = "Mentions and check-ins notify."
        }
    }
}
