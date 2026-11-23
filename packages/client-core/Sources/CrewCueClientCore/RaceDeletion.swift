import Foundation

/// The race owner deletes a race for the whole crew (`DELETE /race-rooms/:roomId`). Copy and
/// outcomes are shared so both apps say the same thing.
public enum RaceDeletion {
    public static let rowTitle = "Delete race"
    public static let rowDetail = "Remove this race for the whole crew"
    public static let confirmButton = "Delete race"
    public static let cancelButton = "Cancel"
    /// What the confirm says. A paid race warns first that its Race Pass goes with it, and every
    /// race points at the fixes that keep it: a new name, or a new course file before the start.
    public static func confirmBody(paid: Bool) -> String {
        var parts: [String] = []
        if paid {
            parts.append("You'll lose this race's Race Pass. It can't be moved to another race or restored.")
        }
        parts.append(alternatives)
        parts.append("Deleting removes the course, plan, check-ins and chat for the whole crew. It can't be undone.")
        return parts.joined(separator: "\n\n")
    }

    /// The changes that don't need a delete.
    public static let alternatives = """
        Wrong name or course? Rename the race in Race & crew, or load a new course file in Pace, \
        until the race starts.
        """
    public static let deletedMessage = "Race deleted."
    public static let offlineMessage = "Offline. Race not deleted."
    public static let notOwnerMessage = "Only the runner who created this race can delete it."
    public static let genericFailureMessage = "Couldn't delete the race."

    public static func confirmTitle(raceName: String) -> String {
        let name = raceName.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "Delete this race?" : "Delete \(name)?"
    }

    public enum Outcome: Equatable, Sendable {
        /// The race is gone, including a race someone already deleted (404).
        case deleted
        case failed(message: String)
    }

    /// Deletes the race. A 404 means it is already gone, which is what the owner asked for.
    public static func run(graph: ClientGraph, roomId: String) async -> Outcome {
        do {
            try await RaceDayAPI.deleteRace(graph: graph, roomId: roomId)
            return .deleted
        } catch {
            return outcome(for: error)
        }
    }

    /// Maps a failed delete to what the user sees. Pure, for both apps and tests.
    public static func outcome(for error: any Error) -> Outcome {
        if TransportFailure.isOffline(error) {
            return .failed(message: offlineMessage)
        }
        switch (error as? ClientHTTPError)?.status {
        case 404:
            return .deleted
        case 403:
            return .failed(message: notOwnerMessage)
        default:
            return .failed(message: genericFailureMessage)
        }
    }
}
