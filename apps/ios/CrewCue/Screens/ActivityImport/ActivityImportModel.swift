import Foundation
import Observation
import CrewCueClientCore

/// Past runs from exported watch files (.gpx, .fit, .tcx) feed pacing history (#652).
@MainActor
@Observable
final class ActivityImportModel {
    private(set) var message = ActivityImport.emptyMessage
    private(set) var items: [ActivityHistoryItem] = []
    private(set) var busy = false

    private let client: AppClient
    private var generation = 0

    init(client: AppClient) {
        self.client = client
    }

    func activate() async {
        await refresh()
    }

    func clear() {
        generation += 1
        items = []
        busy = false
        message = ActivityImport.emptyMessage
    }

    /// The picker returned a file, or failed to.
    func picked(_ result: Result<URL, any Error>) async {
        switch result {
        case .failure:
            message = ActivityImport.errorMessage
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                message = ActivityImport.errorMessage
                return
            }
            await importFile(fileName: url.lastPathComponent, data: data)
        }
    }

    func importFile(fileName: String, data: Data) async {
        guard !busy else { return }
        if let problem = ActivityImport.localProblem(fileName: fileName, byteCount: data.count) {
            message = problem
            return
        }
        busy = true
        message = "Importing \(fileName)…"
        defer { busy = false }
        do {
            let result = try await RaceDayAPI.importActivityFile(graph: client.graph, fileName: fileName, data: data)
            message = result.status == .saved ? ActivityImport.successMessage : ActivityImport.duplicateMessage
            await refresh()
        } catch {
            guard !Task.isCancelled else { return }
            message = ActivityImport.message(for: error)
        }
    }

    private func refresh() async {
        generation += 1
        let ticket = generation
        do {
            let loaded = try await RaceDayAPI.activityHistoryItems(graph: client.graph)
            guard ticket == generation else { return }
            items = loaded
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            if APIFailure.isOffline(error), items.isEmpty {
                message = ActivityImport.offlineMessage
            }
        }
    }
}
