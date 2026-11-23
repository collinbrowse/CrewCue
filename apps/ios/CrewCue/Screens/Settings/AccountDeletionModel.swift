import Foundation
import Observation
import CrewCueClientCore

/// Settings → Delete account (#560). Calls `DELETE /me` through client-core; the view signs out
/// (which wipes the session, outbox and per-user caches) only after the server confirms. A
/// confirmed delete also removes the user's onboarding progress, which sign-out keeps.
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

    /// Returns true when the account is gone and the caller should sign out.
    func delete() async -> Bool {
        guard !deleting else { return false }
        deleting = true
        message = AccountDeletion.workingMessage
        defer { deleting = false }
        switch await AccountDeletion.run(graph: client.graph, onboarding: try? AppDirectories.onboardingStore()) {
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
