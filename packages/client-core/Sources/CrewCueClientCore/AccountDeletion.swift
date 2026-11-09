import Foundation

/// Settings → Delete account (#560, App Store 5.1.1(v), Google Play). Both apps show this copy,
/// call `DELETE /me` through `run`, and sign out (which wipes per-user stores) only on `.deleted`.
public enum AccountDeletion {
    public static let rowTitle = "Delete account"
    public static let confirmTitle = "Delete your account?"
    public static let confirmBody = """
        This permanently deletes your CrewCue account: your profile, race history, pace estimates, \
        Strava connection and device registrations. Races where you are the runner close for your \
        whole crew. Crews you joined keep their race without you. This can't be undone.
        """
    public static let confirmButton = "Delete account"
    public static let cancelButton = "Cancel"
    public static let workingMessage = "Deleting your account…"
    /// Web deletion page (Play requirement). Apps read their build-config URL and fall back to this.
    public static let defaultWebURL = "https://crewcue.app/delete-account"
    public static let webLinkLabel = "Delete on the web instead"

    public enum Outcome: Equatable, Sendable {
        /// Server confirmed. The app signs out next.
        case deleted(identityProvider: String)
        /// Nothing confirmed; the user stays signed in and can retry.
        case failed(message: String, retryable: Bool)
    }

    public static let offlineMessage = "You're offline. Your account was not deleted."
    public static let identityFailedMessage = "Your data was deleted, but we couldn't finish removing your login. Try again."
    public static let genericFailureMessage = "Couldn't delete your account. Try again."
    public static let expiredMessage = "Your session expired. Sign in again to delete your account."

    public static func run(graph: ClientGraph) async -> Outcome {
        do {
            let result = try await RaceDayAPI.deleteAccount(graph: graph)
            return .deleted(identityProvider: result.identityProvider)
        } catch {
            return outcome(for: error)
        }
    }

    /// Maps a failed `DELETE /me` to what the user sees. Pure, for both apps and tests.
    public static func outcome(for error: any Error) -> Outcome {
        if TransportFailure.isOffline(error) {
            return .failed(message: offlineMessage, retryable: true)
        }
        switch (error as? ClientHTTPError)?.status {
        case 401:
            return .failed(message: expiredMessage, retryable: false)
        case 502:
            return .failed(message: identityFailedMessage, retryable: true)
        default:
            return .failed(message: genericFailureMessage, retryable: true)
        }
    }
}
