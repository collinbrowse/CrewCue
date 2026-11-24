import Foundation
import Observation
import CrewCueClientCore

/// The runner's invite for the active race: its join link, its 6-digit code, and the text the
/// share sheet sends (`InviteLink.shareText`, which carries the code too).
struct InviteDetails: Equatable {
    var raceName: String
    var code: String
    var link: URL
    var shareText: String
    /// Not unlocked yet: the server refuses joins until the runner pays.
    var locked: Bool
}

@MainActor
@Observable
final class InviteShareModel {
    enum State: Equatable {
        case loading
        case ready(InviteDetails)
        case empty
        case error
        case offline
    }

    private(set) var state: State = .loading
    /// "Code copied." after Copy code, until the next load.
    private(set) var notice = ""
    private let client: AppClient
    private var generation = 0

    init(client: AppClient) {
        self.client = client
    }

    var message: String {
        switch state {
        case .loading: ""
        case .ready(let details): details.locked ? InviteCopy.shareLocked : InviteCopy.shareReady
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
            state = .empty
            return
        }
        if case .ready = state {} else { state = .loading }
        do {
            let room = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId).room
            guard ticket == generation, !Task.isCancelled else { return }
            state = Self.state(for: room)
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
    }

    static func state(for room: RaceRoom) -> State {
        let code = room.joinCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let link = InviteLink.build(code: code),
              let text = InviteLink.shareText(raceName: room.name, code: code) else { return .empty }
        return .ready(InviteDetails(
            raceName: room.name,
            code: code,
            link: link,
            shareText: text,
            locked: room.entitlement.status == "unpaid"
        ))
    }
}
