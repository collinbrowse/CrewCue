import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class JoinCrewModel {
    var code = "" {
        didSet { sanitizeCode(previous: oldValue) }
    }

    private(set) var previewText = ""
    private(set) var statusMessage = "Enter an invite code."
    private(set) var isWorking = false
    private(set) var previewedCode: String?
    private let client: AppClient
    var onJoined: @MainActor (String, String?) -> Void = { _, _ in }

    init(client: AppClient) {
        self.client = client
    }

    var canJoin: Bool {
        previewedCode == code && code.count == 6 && !isWorking
    }

    func preview() {
        guard !isWorking else { return }
        guard code.count == 6 else {
            previewText = ""
            previewedCode = nil
            statusMessage = "Enter an invite code."
            return
        }
        let requested = code
        isWorking = true
        Task {
            await runPreview(requested)
            isWorking = false
        }
    }

    func join() {
        guard !isWorking else { return }
        guard canJoin else {
            statusMessage = "Enter an invite code."
            return
        }
        guard client.graph.session?.session != nil else {
            statusMessage = "No session."
            return
        }
        let requested = code
        isWorking = true
        Task {
            await runJoin(requested)
            isWorking = false
        }
    }

    private func sanitizeCode(previous: String) {
        let filtered = String(code.filter(\.isNumber).prefix(6))
        if filtered != code {
            code = filtered
            return
        }
        guard code != previous else { return }
        previewText = ""
        previewedCode = nil
        if code.isEmpty {
            statusMessage = "Enter an invite code."
        }
    }

    private func runPreview(_ requested: String) async {
        do {
            let preview = try await RaceDayAPI.previewJoin(graph: client.graph, code: requested)
            guard code == requested else { return }
            previewedCode = requested
            previewText = Self.previewLine(preview)
            statusMessage = "Invite code ready for preview."
        } catch {
            guard code == requested else { return }
            previewText = ""
            previewedCode = nil
            statusMessage = Self.message(for: error)
        }
    }

    private func runJoin(_ requested: String) async {
        do {
            let envelope = try await RaceDayAPI.join(graph: client.graph, code: requested)
            guard code == requested else { return }
            statusMessage = "Invite code ready for preview, then membership on join."
            onJoined(envelope.room.id, envelope.assignedRole)
        } catch {
            guard code == requested else { return }
            statusMessage = Self.message(for: error)
        }
    }

    private static func message(for error: Error) -> String {
        if APIFailure.isTransport(error) {
            return "Offline. Invite preview needs the network."
        }
        return "That invite code was not found."
    }

    private static func previewLine(_ preview: RaceRoomJoinPreview) -> String {
        let count: String
        if preview.memberCount.rounded() == preview.memberCount {
            count = String(Int(preview.memberCount))
        } else {
            count = String(preview.memberCount)
        }
        return "\(preview.roomName), \(count) members, \(preview.status)"
    }
}
