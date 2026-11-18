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
    /// The last import failed for want of a network.
    private(set) var offline = false

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
        offline = false
        message = ActivityImport.emptyMessage
    }

    /// The picker returned a file, or failed to. Answers how the import ended, nil when it didn't.
    @discardableResult
    func picked(_ result: Result<URL, any Error>) async -> ActivityImportStatus? {
        switch result {
        case .failure:
            message = ActivityImport.errorMessage
            return nil
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                message = ActivityImport.errorMessage
                return nil
            }
            return await importFile(fileName: url.lastPathComponent, data: data)
        }
    }

    @discardableResult
    func importFile(fileName: String, data: Data) async -> ActivityImportStatus? {
        guard !busy else { return nil }
        offline = false
        if let problem = ActivityImport.localProblem(fileName: fileName, byteCount: data.count) {
            message = problem
            return nil
        }
        busy = true
        message = "Importing \(fileName)…"
        defer { busy = false }
        do {
            let result = try await RaceDayAPI.importActivityFile(graph: client.graph, fileName: fileName, data: data)
            message = result.status == .saved ? ActivityImport.successMessage : ActivityImport.duplicateMessage
            await refresh()
            return result.status
        } catch {
            guard !Task.isCancelled else { return nil }
            offline = APIFailure.isOffline(error)
            message = ActivityImport.message(for: error)
            return nil
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
