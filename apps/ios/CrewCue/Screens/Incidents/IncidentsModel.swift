import Foundation
import Observation
import CrewCueClientCore

struct IncidentLine: Identifiable, Equatable {
    var id: String
    var summary: String
}

@MainActor
@Observable
final class IncidentsModel {
    static let categories = ["fuel", "hydration", "aid_duration", "equipment", "protocol_deviation", "other"]
    static let severities = ["low", "medium", "high"]

    private(set) var lines: [IncidentLine] = []
    private(set) var message = ""
    private(set) var working = false
    var summaryDraft = ""
    var category = "other"
    var severity = "low"
    var checkpointDraft = ""

    private let client: AppClient
    private var generation = 0
    private var roomId: String?

    init(client: AppClient) {
        self.client = client
    }

    func activate(roomId: String?) async {
        generation += 1
        let ticket = generation
        self.roomId = Self.trimmed(roomId)
        guard let roomId = self.roomId else {
            lines = []
            message = "No incidents."
            return
        }
        await reload(roomId: roomId, ticket: ticket)
    }

    func submit() async {
        let summary = summaryDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let roomId, !working, summary.isEmpty == false else { return }
        guard Self.categories.contains(category), Self.severities.contains(severity) else {
            message = "Couldn't load incidents."
            return
        }
        let ticket = generation
        working = true
        defer { working = false }
        let checkpoint = checkpointDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await RaceDayAPI.createIncident(
                graph: client.graph,
                roomId: roomId,
                category: category,
                severity: severity,
                summary: summary,
                checkpointId: checkpoint.isEmpty ? nil : checkpoint
            )
            guard ticket == generation, !Task.isCancelled else { return }
            summaryDraft = ""
            checkpointDraft = ""
            await reload(roomId: roomId, ticket: ticket)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            message = Self.failureText(error)
        }
    }

    func clear() {
        generation += 1
        lines = []
        message = ""
        summaryDraft = ""
        category = "other"
        severity = "low"
        checkpointDraft = ""
        working = false
        roomId = nil
    }

    private func reload(roomId: String, ticket: Int) async {
        do {
            let events = try await RaceDayAPI.incidents(graph: client.graph, roomId: roomId)
            guard ticket == generation, !Task.isCancelled else { return }
            lines = events.map { IncidentLine(id: $0.id, summary: $0.summary) }
            message = lines.isEmpty ? "No incidents." : ""
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            message = Self.failureText(error)
        }
    }

    private static func failureText(_ error: Error) -> String {
        APIFailure.isOffline(error) ? "Offline. Incidents not updated." : "Couldn't load incidents."
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}
