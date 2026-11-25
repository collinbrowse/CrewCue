import Foundation

/// Words both apps show on the runner's invite screen and on a join link's race preview, plus the
/// two pure readings behind them: whose race a join preview is, and the code in pasted text.
public enum InviteCopy {
    public static let shareTitle = "Invite your crew"
    public static let shareDetail = "Send this link to your crew. It opens CrewCue on their phone, or the code works in the app."
    public static let shareReady = "Invite ready to share."
    public static let shareEmpty = "No invite code for this race yet."
    public static let shareError = "Couldn't load the invite."
    public static let shareOffline = "Offline. The invite needs the network."
    /// The race isn't unlocked: the server refuses joins until it is.
    public static let shareLocked = "Crew can join once you unlock this race."
    public static let shareButton = "Share invite"
    public static let copyCode = "Copy code"
    public static let codeCopied = "Code copied."
    public static let codeLabel = "Invite code"
    public static let linkLabel = "Invite link"

    public static let joinLinkTitle = "Join a race"
    /// A link opened without a code it could read: offer Paste or typing the code.
    public static let linkWithoutCode = "That link didn't include an invite code. Paste it or type the 6 digits."
    public static let pasteLabel = "Paste invite code"
    public static let pasteNoCode = "No invite code in what you pasted."
    /// Signed out: the join button saves the code, then sign-up joins.
    public static let signUpToJoin = "Sign up to join"
    public static let signUpToJoinDetail = "Create an account and you'll join this race straight after."
    public static let joining = "Joining the race…"

    public static let joinTitle = "Join your crew"
    public static let joinPrompt = "Enter the 6-digit code from your crew."
    public static let joinEmpty = "Enter an invite code."
    public static let joinReady = "Invite code ready for preview."
    public static let joinPreviewOffline = "Offline. Invite preview needs the network."
    public static let joinNotFound = PendingJoinOutcome.invalidCodeMessage
    public static let joinDone = "Invite code ready for preview, then membership on join."
    public static let joinButton = "Join"
    public static let previewPlaceholder = "The race appears here once the code is found."
    public static let inviteCrewButton = "Invite crew"
    public static let backToMembers = "Room members"

    /// A join that answered after the screen moved on to another code (a link arrived meanwhile).
    public static func joinedRace(_ raceName: String) -> String {
        let name = raceName.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return name.isEmpty ? "Joined the race." : "Joined \(name)."
    }

    /// A join's failure, named by its code, after the screen moved on to another code.
    public static func joinFailed(code: String, message: String) -> String {
        "Code \(code): \(message)"
    }

    /// "Western States 100, 1 member, active".
    public static func previewLine(_ preview: RaceRoomJoinPreview) -> String {
        let whole = preview.memberCount.rounded() == preview.memberCount
        let count = whole ? String(Int(preview.memberCount)) : String(preview.memberCount)
        return "\(preview.roomName), \(count) \(count == "1" ? "member" : "members"), \(preview.status)"
    }

    /// The runner's invite for a race: nil when it has no join code yet.
    public static func shareDetails(for room: RaceRoom) -> InviteShareDetails? {
        let code = room.joinCode?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard let link = InviteLink.build(code: code),
              let text = InviteLink.shareText(raceName: room.name, code: code) else { return nil }
        return InviteShareDetails(
            raceName: room.name, code: code, link: link, shareText: text,
            locked: room.entitlement.status == "unpaid"
        )
    }

    /// "You're joining Sam's race". A blank runner name reads "You're joining this race".
    public static func joiningRace(runner: String?) -> String {
        let name = (runner ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return name.isEmpty ? "You're joining this race" : "You're joining \(name)'s race"
    }

    /// The runner's display name from a join preview: the `athlete` member's, nil when none is
    /// named. The server fills a missing name with `Member <id prefix>`, which reads as no name.
    public static func runnerName(_ preview: RaceRoomJoinPreview) -> String? {
        guard let athlete = preview.members.first(where: { $0.role == "athlete" }) else { return nil }
        let name = athlete.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !name.hasPrefix("Member ") else { return nil }
        return name
    }

    /// The invite code in pasted text: a join link (`InviteLink.parse`), the share text (its link,
    /// else its `code <digits>`), or six digits on their own (spaces and dashes between them
    /// allowed, as in `123 456`). Nil when none is there or two different codes are.
    public static func pastedCode(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= InviteLink.maxInputLength else { return nil }
        if let code = InviteLink.parse(trimmed) { return code }
        let words = trimmed.split(whereSeparator: \.isWhitespace).map { word in
            String(word).trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?()<>\"'"))
        }
        var found = Set(words.compactMap { InviteLink.parse($0) })
        // A bare code: the whole text once spaces and dashes are gone, or one six-digit word.
        let compact = trimmed.filter { $0 != " " && $0 != "-" }
        if InviteLink.isCode(compact) {
            found.insert(compact)
        } else {
            found.formUnion(words.filter(InviteLink.isCode))
        }
        return found.count == 1 ? found.first : nil
    }
}

/// What the runner's invite screen shows (`InviteCopy.shareDetails`).
public struct InviteShareDetails: Equatable, Sendable {
    public var raceName: String
    public var code: String
    public var link: URL
    /// `InviteLink.shareText`: the link and the code.
    public var shareText: String
    /// Not unlocked yet: the server refuses joins until the runner pays (`InviteCopy.shareLocked`).
    public var locked: Bool

    public init(raceName: String, code: String, link: URL, shareText: String, locked: Bool) {
        self.raceName = raceName
        self.code = code
        self.link = link
        self.shareText = shareText
        self.locked = locked
    }

    /// The line under the actions: the locked note, else ready.
    public var status: String { locked ? InviteCopy.shareLocked : InviteCopy.shareReady }
}
