import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class JoinCrewModel {
    var code = "" {
        didSet { sanitizeCode(previous: oldValue) }
    }

    private(set) var previewText = ""
    /// "You're joining Sam's race", once a preview answered for the code.
    private(set) var joiningHeadline = ""
    private(set) var statusMessage = InviteCopy.joinEmpty
    private(set) var isWorking = false
    /// A join request is in flight (typed here, or the pending invite after sign-in), as opposed
    /// to a code preview.
    private(set) var joining = false
    /// The last join answered that the race's crew is full.
    private(set) var raceFull = false
    /// How a join the screen moved on from ended (a link arrived while it was out). The status
    /// line follows the code on screen; this keeps the earlier join's answer in view.
    private(set) var notice = ""
    private(set) var previewedCode: String?
    private let client: AppClient
    /// A join landed: the room, the role the server gave, and the code it was for (which may no
    /// longer be the code on screen, when a link arrived while it was out).
    var onJoined: @MainActor (String, String?, String) -> Void = { _, _, _ in }
    /// Signed out, Join hands the code over: it is saved as the pending invite and sign-up joins it.
    var onNeedsAccount: @MainActor (String) -> Void = { _ in }

    init(client: AppClient) {
        self.client = client
    }

    var isSignedIn: Bool { client.graph.session?.session != nil }

    var canJoin: Bool {
        previewedCode == code && code.count == 6 && !isWorking
    }

    /// A code from a join link (or the pending invite read back at launch): shown and previewed.
    func adopt(code incoming: String) {
        guard InviteLink.isCode(incoming) else { return }
        if code != incoming {
            code = incoming
        }
        raceFull = false
        if previewedCode != incoming {
            preview()
        }
    }

    /// A join link arrived without a code that reads: ask for Paste or typing.
    func noteLinkWithoutCode() {
        code = ""
        raceFull = false
        statusMessage = InviteCopy.linkWithoutCode
    }

    /// The Paste button: a link, the share text, or the bare code.
    func paste(_ text: String?) {
        guard let pasted = text.flatMap(InviteCopy.pastedCode) else {
            raceFull = false
            statusMessage = InviteCopy.pasteNoCode
            return
        }
        adopt(code: pasted)
    }

    func preview() {
        guard !isWorking else { return }
        guard code.count == 6 else {
            clearPreview()
            statusMessage = InviteCopy.joinEmpty
            return
        }
        let requested = code
        isWorking = true
        Task {
            await runPreview(requested)
            isWorking = false
            // A code that arrived while this preview was out (a link opened, a paste) gets its own.
            if code != requested, code.count == 6, previewedCode != code {
                preview()
            }
        }
    }

    func join() {
        guard !isWorking else { return }
        guard canJoin else {
            statusMessage = InviteCopy.joinEmpty
            return
        }
        guard isSignedIn else {
            onNeedsAccount(code)
            return
        }
        let requested = code
        isWorking = true
        joining = true
        raceFull = false
        notice = ""
        Task {
            await runJoin(requested)
            isWorking = false
            joining = false
            // A code that arrived while the join was out gets its preview now.
            if code != requested, code.count == 6, previewedCode != code {
                preview()
            }
        }
    }

    /// The pending invite is being joined after sign-in.
    func beginAutoJoin() {
        joining = true
        raceFull = false
        statusMessage = InviteCopy.joining
    }

    /// The auto-join after sign-in landed, and a newer link is pending: the screen leaves the busy
    /// state and shows that code with its preview.
    func endAutoJoin(adopting next: String) {
        joining = false
        adopt(code: next)
    }

    /// Back closed the join screen: an earlier join's note doesn't follow the person back.
    func dismissNotice() {
        notice = ""
    }

    /// What joining the pending invite came to, when it didn't land in the race.
    func show(_ outcome: PendingJoinOutcome) {
        joining = false
        raceFull = outcome == .raceFull
        if let message = outcome.message {
            statusMessage = message
        }
    }

    func clear() {
        notice = ""
        code = ""
        clearPreview()
        raceFull = false
        joining = false
        statusMessage = InviteCopy.joinEmpty
    }

    private func clearPreview() {
        previewText = ""
        joiningHeadline = ""
        previewedCode = nil
    }

    private func sanitizeCode(previous: String) {
        let filtered = String(code.filter(\.isNumber).prefix(6))
        if filtered != code {
            code = filtered
            return
        }
        guard code != previous else { return }
        clearPreview()
        raceFull = false
        if code.isEmpty {
            statusMessage = InviteCopy.joinEmpty
        }
    }

    private func runPreview(_ requested: String) async {
        do {
            let preview = try await RaceDayAPI.previewJoin(graph: client.graph, code: requested)
            guard code == requested else { return }
            previewedCode = requested
            previewText = InviteCopy.previewLine(preview)
            joiningHeadline = InviteCopy.joiningRace(runner: InviteCopy.runnerName(preview))
            if !joining {
                statusMessage = isSignedIn ? InviteCopy.joinReady : InviteCopy.signUpToJoinDetail
            }
        } catch {
            guard code == requested else { return }
            clearPreview()
            statusMessage = Self.message(for: error)
        }
    }

    private func runJoin(_ requested: String) async {
        do {
            let envelope = try await RaceDayAPI.join(graph: client.graph, code: requested)
            // The membership stands whatever the screen shows now: always hand it on.
            if code == requested {
                statusMessage = InviteCopy.joinDone
            } else {
                notice = InviteCopy.joinedRace(envelope.room.name)
            }
            onJoined(envelope.room.id, envelope.assignedRole, requested)
        } catch {
            let full = BillingErrors.isCrewLimit(error)
            let message = full ? PendingJoinOutcome.raceFullMessage : Self.message(for: error)
            guard code == requested else {
                // Another code is on screen now: say which join this was.
                notice = InviteCopy.joinFailed(code: requested, message: message)
                return
            }
            raceFull = full
            statusMessage = message
        }
    }

    private static func message(for error: Error) -> String {
        APIFailure.isTransport(error) ? InviteCopy.joinPreviewOffline : InviteCopy.joinNotFound
    }
}
