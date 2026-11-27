import Foundation

/// Sign-out: this phone stops getting the signed-out account's pushes.
///
/// Both apps call `run` while signing out, with a graph that still carries the signed-out
/// session's token (captured before the app clears it), and never wait on it: sign-out finishes
/// offline too. The request runs under `Deadline`, so a dead connection can't hold it, and it is
/// never cancelled (cancelling a request inside `URLSession` deadlocks Foundation on Android).
/// Nothing is queued in the outbox, so a later launch never sends it for an account that is gone.
public enum PushDeviceUnregister {
    /// How long sign-out's request may take before it is abandoned.
    public static let deadlineSeconds = 10.0

    public enum Outcome: Equatable, Sendable {
        /// The server holds no row for this account and device (removed now, or never there).
        case removed
        /// Not removed: offline, no session, or the server said no. The row stays until the
        /// provider rejects the token or another account registers this phone's token.
        case failed(offline: Bool)
    }

    public static func run(graph: ClientGraph, deviceId: String) async -> Outcome {
        let deviceId = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !deviceId.isEmpty else { return .failed(offline: false) }
        guard let token = await graph.tokenProvider?.accessToken(), !token.isEmpty else {
            return .failed(offline: false)
        }
        do {
            try await Deadline.run(seconds: deadlineSeconds) {
                try await RaceDayAPI.unregisterPushDevice(graph: graph, deviceId: deviceId)
            }
            return .removed
        } catch {
            return .failed(offline: TransportFailure.isOffline(error))
        }
    }
}
