import Foundation
import Observation
import CrewCueClientCore

struct AthleteDraft: Codable, Equatable, Sendable {
    var displayName: String
}

@MainActor
@Observable
final class AthleteSetupModel {
    var displayName: String
    private(set) var message = ""
    private(set) var isWorking = false
    private let client: AppClient
    var onSaved: @MainActor (String) -> Void = { _ in }

    init(client: AppClient) {
        self.client = client
        self.displayName = Self.loadDraft() ?? ""
    }

    var statusText: String {
        if displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Name is required."
        }
        return message
    }

    func save() {
        guard !isWorking else { return }
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            message = "Name is required."
            return
        }
        isWorking = true
        Task {
            await performSave(trimmed)
            isWorking = false
        }
    }

    private func performSave(_ trimmed: String) async {
        guard let session = client.graph.session?.session, let roomId = session.roomId, !roomId.isEmpty else {
            saveDraft(trimmed)
            message = "Offline. Setup will sync when the network returns."
            return
        }
        do {
            _ = try await RaceDayAPI.updateDisplayName(
                graph: client.graph,
                roomId: roomId,
                userId: session.userId,
                displayName: trimmed
            )
            saveDraft(trimmed)
            message = "Athlete profile saved on this device."
            onSaved(trimmed)
        } catch {
            if APIFailure.isTransport(error) {
                saveDraft(trimmed)
                message = "Offline. Setup will sync when the network returns."
            } else {
                message = "Couldn't save athlete setup."
            }
        }
    }

    private func saveDraft(_ name: String) {
        guard let url = try? AppDirectories.athleteDraftURL(),
              let data = try? JSONEncoder().encode(AthleteDraft(displayName: name)) else {
            return
        }
        try? data.write(to: url, options: .atomic)
    }

    private static func loadDraft() -> String? {
        guard let url = try? AppDirectories.athleteDraftURL(),
              FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let draft = try? JSONDecoder().decode(AthleteDraft.self, from: data) else {
            return nil
        }
        let trimmed = draft.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
