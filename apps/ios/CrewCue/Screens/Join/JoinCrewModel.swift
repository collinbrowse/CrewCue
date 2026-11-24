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
    private(set) var statusMessage = "Enter an invite code."
    private(set) var isWorking = false
    /// A join request is in flight (typed here, or the pending invite after sign-in), as opposed
    /// to a code preview.
    private(set) var joining = false
    /// The last join answered that the race's crew is full.
    private(set) var raceFull = false
    private(set) var previewedCode: String?
    private let client: AppClient
    var onJoined: @MainActor (String, String?) -> Void = { _, _ in }
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
            statusMessage = "Enter an invite code."
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
            statusMessage = "Enter an invite code."
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
        Task {
            await runJoin(requested)
            isWorking = false
            joining = false
        }
    }

    /// The pending invite is being joined after sign-in.
    func beginAutoJoin() {
        joining = true
        raceFull = false
        statusMessage = InviteCopy.joining
    }

    /// What joining the pending invite came to, when it didn't land in the race.
    func show(_ outcome: PendingJoinOutcome) {
        joining = false
        raceFull = outcome == .raceFull
        if raceFull {
            // The same words as a full race refusing Join on this screen.
            statusMessage = BillingErrors.crewLimitForCrew.message
        } else if let message = outcome.message {
            statusMessage = message
        }
    }

    func clear() {
        code = ""
        clearPreview()
        raceFull = false
        joining = false
        statusMessage = "Enter an invite code."
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
            statusMessage = "Enter an invite code."
        }
    }

    private func runPreview(_ requested: String) async {
        do {
            let preview = try await RaceDayAPI.previewJoin(graph: client.graph, code: requested)
            guard code == requested else { return }
            previewedCode = requested
            previewText = Self.previewLine(preview)
            joiningHeadline = InviteCopy.joiningRace(runner: InviteCopy.runnerName(preview))
            if !joining {
                statusMessage = isSignedIn ? "Invite code ready for preview." : InviteCopy.signUpToJoinDetail
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
            guard code == requested else { return }
            statusMessage = "Invite code ready for preview, then membership on join."
            onJoined(envelope.room.id, envelope.assignedRole)
        } catch {
            guard code == requested else { return }
            raceFull = BillingErrors.isCrewLimit(error)
            statusMessage = raceFull ? BillingErrors.crewLimitForCrew.message : Self.message(for: error)
        }
    }

    private static func message(for error: Error) -> String {
        if APIFailure.isTransport(error) {
            return "Offline. Invite preview needs the network."
        }
        return "That invite code was not found."
    }

    private static func previewLine(_ preview: RaceRoomJoinPreview) -> String {
        let count: String
        if preview.memberCount.rounded() == preview.memberCount {
            count = String(Int(preview.memberCount))
        } else {
            count = String(preview.memberCount)
        }
        return "\(preview.roomName), \(count) \(count == "1" ? "member" : "members"), \(preview.status)"
    }
}
