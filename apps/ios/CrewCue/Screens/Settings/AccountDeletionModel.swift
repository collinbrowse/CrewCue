import Foundation
import Observation
import CrewCueClientCore

/// Settings → Delete account (#560). Calls `DELETE /me` through client-core; the view signs out
/// (which wipes the session, outbox and per-user caches) only after the server confirms.
@MainActor
@Observable
final class AccountDeletionModel {
    var confirming = false
    private(set) var deleting = false
    private(set) var message = ""

    private let client: AppClient

    init(client: AppClient) {
        self.client = client
    }

    /// The web deletion page from build config (`CrewCueAccountDeletionURL`), else the default.
    var webURL: URL? {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "CrewCueAccountDeletionURL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let candidate = raw.hasPrefix("https://") ? raw : AccountDeletion.defaultWebURL
        return URL(string: candidate)
    }

    /// Returns true when the account is gone and the caller should sign out.
    func delete() async -> Bool {
        guard !deleting else { return false }
        deleting = true
        message = AccountDeletion.workingMessage
        defer { deleting = false }
        switch await AccountDeletion.run(graph: client.graph) {
        case .deleted:
            message = ""
            return true
        case let .failed(failure, _):
            message = failure
            return false
        }
    }

    func clear() {
        confirming = false
        message = ""
    }
}
