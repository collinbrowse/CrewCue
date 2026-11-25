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
    /// The run being removed, so its row shows progress and the list ignores a second swipe.
    private(set) var removingId: String?
    /// Shown in the runs sheet after a removal, or when one failed.
    private(set) var removalMessage: String?
    /// After a removal, the sheet offers Recalculate for the open race.
    private(set) var offersRecalculate = false

    /// Whether an open race's estimate reads these runs, and how to recalculate it. Wired by the shell.
    var canRecalculate: @MainActor () -> Bool = { false }
    var recalculate: @MainActor () async -> Void = {}

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
        removingId = nil
        removalMessage = nil
        offersRecalculate = false
    }

    /// Settings → Imported runs: the athlete confirmed removing one run from pacing history.
    func remove(_ item: ActivityHistoryItem) async {
        guard removingId == nil else { return }
        removingId = item.id
        defer { removingId = nil }
        offersRecalculate = false
        switch await ActivityHistoryDelete.run(graph: client.graph, id: item.id) {
        case .removed:
            items.removeAll { $0.id == item.id }
            let recalculates = canRecalculate()
            offersRecalculate = recalculates
            removalMessage = ActivityHistoryDelete.afterRemoval(canRecalculate: recalculates)
            await refresh()
        case .failed(let message, _):
            removalMessage = message
        }
    }

    /// The Recalculate offer after a removal.
    func recalculateAfterRemoval() async {
        offersRecalculate = false
        removalMessage = nil
        await recalculate()
    }

    /// The runs sheet closed: drop its one-off status.
    func dismissRemovalStatus() {
        removalMessage = nil
        offersRecalculate = false
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
