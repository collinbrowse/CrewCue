import Foundation
import Observation
import CrewCueClientCore

/// The runner's invite for the active race: client-core's `InviteShareDetails` (the join link,
/// the 6-digit code, the share text, the lock), loaded from the race room.
@MainActor
@Observable
final class InviteShareModel {
    enum State: Equatable {
        case loading
        case ready(InviteShareDetails)
        case empty
        case error
        case offline
    }

    private(set) var state: State = .loading
    /// "Code copied." after Copy code, until the next load.
    private(set) var notice = ""
    private let client: AppClient
    private var generation = 0
    /// The room the state belongs to: another room starts from the loader, never the old code.
    private var loadedRoomId: String?

    init(client: AppClient) {
        self.client = client
    }

    var message: String {
        switch state {
        case .loading: ""
        case .ready(let details): details.status
        case .empty: InviteCopy.shareEmpty
        case .error: InviteCopy.shareError
        case .offline: InviteCopy.shareOffline
        }
    }

    func activate(roomId: String?) async {
        generation += 1
        let ticket = generation
        notice = ""
        let roomId = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !roomId.isEmpty else {
            loadedRoomId = nil
            state = .empty
            return
        }
        // The same room keeps its code on screen while it refreshes; another room doesn't.
        if case .ready = state, loadedRoomId == roomId {} else { state = .loading }
        loadedRoomId = roomId
        do {
            let room = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId).room
            guard ticket == generation, !Task.isCancelled else { return }
            state = InviteCopy.shareDetails(for: room).map(State.ready) ?? .empty
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            state = APIFailure.isOffline(error) ? .offline : .error
        }
    }

    func noteCopied() {
        notice = InviteCopy.codeCopied
    }

    func clear() {
        generation += 1
        state = .loading
        notice = ""
        loadedRoomId = nil
    }
}
