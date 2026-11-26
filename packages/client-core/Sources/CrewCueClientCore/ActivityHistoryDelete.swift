import Foundation

/// Settings → Imported runs: remove one run so it stops shaping the pace estimate.
/// Both apps show this copy, call `run`, then reload the list and offer to recalculate.
public enum ActivityHistoryDelete {
    public static let actionTitle = "Remove"
    public static let confirmTitle = "Remove this run?"
    public static let confirmBody = "It will no longer shape your pace estimate. You can import the file again later."
    public static let confirmButton = "Remove run"
    public static let cancelButton = "Cancel"
    public static let removedMessage = "Run removed. Your next estimate leaves it out."
    public static let recalculatePrompt = "Run removed. Recalculate your estimate without it?"
    public static let recalculateButton = "Recalculate"
    public static let recalculatedMessage = "Estimate recalculated. Open Pace to see it."
    public static let recalculateFailedMessage = "Couldn't recalculate the estimate. Try again."
    public static let offlineMessage = "You're offline. The run was not removed."
    public static let failureMessage = "Couldn't remove the run. Try again."

    /// The same strings for Android, through runtime op `activityDeleteCopy`.
    static var copy: [String: String] {
        [
            "actionTitle": actionTitle,
            "confirmTitle": confirmTitle,
            "confirmBody": confirmBody,
            "confirmButton": confirmButton,
            "cancelButton": cancelButton,
            "removedMessage": removedMessage,
            "recalculatePrompt": recalculatePrompt,
            "recalculateButton": recalculateButton,
            "recalculatedMessage": recalculatedMessage,
            "recalculateFailedMessage": recalculateFailedMessage,
            "offlineMessage": offlineMessage,
            "failureMessage": failureMessage
        ]
    }

    public enum Outcome: Equatable, Sendable {
        /// The run is gone from pacing history (or already was).
        case removed
        /// Nothing changed; `message` says why.
        case failed(message: String, offline: Bool)
    }

    public static func run(graph: ClientGraph, id: String) async -> Outcome {
        guard !id.isEmpty else { return .failed(message: failureMessage, offline: false) }
        do {
            try await RaceDayAPI.deleteActivity(graph: graph, id: id)
            return .removed
        } catch {
            if TransportFailure.isOffline(error) {
                return .failed(message: offlineMessage, offline: true)
            }
            return .failed(message: failureMessage, offline: false)
        }
    }

    /// The hint under the list after a removal: offer Recalculate only where there is a race to recalculate.
    public static func afterRemoval(canRecalculate: Bool) -> String {
        canRecalculate ? recalculatePrompt : removedMessage
    }
}
