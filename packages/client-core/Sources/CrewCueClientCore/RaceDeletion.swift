import Foundation

/// The race owner deletes a race for the whole crew (`DELETE /race-rooms/:roomId`). Copy and
/// outcomes are shared so both apps say the same thing.
public enum RaceDeletion {
    public static let rowTitle = "Delete race"
    public static let rowDetail = "Remove this race for the whole crew"
    public static let confirmButton = "Delete race"
    public static let cancelButton = "Cancel"
    public static let confirmBody = """
        This deletes the race for the whole crew: the course, plan, check-ins and chat. \
        It can't be undone.
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
