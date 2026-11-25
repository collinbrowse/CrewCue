import Foundation
import Observation
import CrewCueClientCore

/// A run file shared or opened in CrewCue (run-share-import): preview, then the runner confirms.
/// Flow and copy are client-core `SharedRunImport`; this holds the file between the two calls.
@MainActor
@Observable
final class SharedRunImportModel {
    /// Nil while no file is in flight; the sheet shows for any other state.
    private(set) var state: SharedRunImportState? {
        didSet { if case .preview = state {} else { showMoreTaps = 0 } }
    }
    /// How many times the runner tapped Show more; each tap lists more runs (client-core
    /// `listedCount(afterTaps:)`). Kept here so a size change (iPhone Duo fold) keeps the list open.
    var showMoreTaps = 0
    var isPresented: Bool {
        get { state != nil }
        set { if !newValue { dismiss() } }
    }

    private let client: AppClient
    private var file: (name: String, data: Data)?
    private var generation = 0
    /// Called after an import saved runs, so Settings > Past runs reloads.
    var onImported: (() async -> Void)?

    init(client: AppClient) {
        self.client = client
    }

    /// A file URL from the share sheet, "Open in", or the dev link. Copied in, never edited in place.
    /// Read off the main thread: a whole watch-app export can be 100+ MB.
    func receive(url: URL, signedIn: Bool) {
        generation += 1
        let ticket = generation
        file = nil
        state = signedIn ? .reading(fileName: url.lastPathComponent) : .signedOut
        guard signedIn else { return }
        Task {
            let data = await Task.detached(priority: .userInitiated) { () -> Data? in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                return try? Data(contentsOf: url, options: .mappedIfSafe)
            }.value
            guard ticket == generation else { return }
            guard let data else {
                // The sending app didn't let CrewCue read the file.
                state = .failed(SharedRunImport.unreadableMessage)
                return
            }
            receive(fileName: url.lastPathComponent, data: data, signedIn: signedIn)
        }
    }

    func receive(fileName: String, data: Data, signedIn: Bool) {
        generation += 1
        let ticket = generation
        let start = SharedRunImport.start(signedIn: signedIn, fileName: fileName, byteCount: data.count)
        state = start
        guard case .reading = start else {
            file = nil
            return
        }
        file = (fileName, data)
        Task {
            let result: Result<ActivityUploadPreview, any Error>
            do {
                result = .success(try await RaceDayAPI.previewActivityUpload(graph: client.graph, fileName: fileName, data: data))
            } catch {
                result = .failure(error)
            }
            guard ticket == generation else { return }
            state = SharedRunImport.afterPreview(result)
        }
    }

    func confirm() async {
        guard case .preview(let preview) = state, preview.canImport, let file else { return }
        let ticket = generation
        state = .importing
        let result: Result<ActivityUploadResult, any Error>
        do {
            result = .success(try await RaceDayAPI.importActivityUpload(graph: client.graph, fileName: file.name, data: file.data))
        } catch {
            result = .failure(error)
        }
        guard ticket == generation else { return }
        state = SharedRunImport.afterImport(result)
        if case .success(let done) = result, done.saved > 0 {
            await onImported?()
        }
    }

    /// The dev link with no file: the sheet with the share tip.
    func showTip() {
        generation += 1
        file = nil
        state = .failed(SharedRunImport.tip)
    }

    func dismiss() {
        generation += 1
        state = nil
        file = nil
    }
}
