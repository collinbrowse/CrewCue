import Foundation

/// What an opened URL means for joining: a join link with its code, a join link whose code can't
/// be read (offer Paste or typing), or not a join link. Both apps route links through this before
/// their Debug-only `crewcue://dev/*` routes, so Release builds open invites too.
public enum InviteLinkRoute: Equatable, Sendable {
    case invite(InviteMatch)
    case withoutCode
}

extension InviteLink {
    /// `invite` for anything `match` reads (the join page, `crewcue://join/<code>`); `withoutCode`
    /// for the join page's https link (its path or below) or `crewcue://join` with no readable
    /// code; nil for every other URL.
    public static func route(_ url: String) -> InviteLinkRoute? {
        if let invite = match(url) { return .invite(invite) }
        return isJoinLink(url) ? .withoutCode : nil
    }

    /// The join page's https link or `crewcue://join…`, whether or not its code reads.
    public static func isJoinLink(_ url: String) -> Bool {
        guard url.utf8.count <= maxInputLength,
              let components = URLComponents(string: url.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased() else { return false }
        let host = components.host?.lowercased() ?? ""
        switch scheme {
        case "https":
            let path = components.path.hasSuffix("/") ? components.path : components.path + "/"
            return host == Self.host && path.lowercased().hasPrefix(Self.path)
        case appScheme:
            return host == appHost
        default:
            return false
        }
    }
}

extension OnboardingStore {
    /// The signed-out invite to join right after sign-in: the guest's pending code, confirmed
    /// (Sign up to join) within `OnboardingProgress.confirmedInviteLifetime` of `now`. Nil when
    /// none is, so a link opened and left, or confirmed long ago, never joins on sign-in. Read
    /// this before the sign-in's first `read`, which adopts the guest progress.
    public func confirmedInviteForSignIn(now: Date) -> PendingJoin? {
        guard let pending = pendingJoins.read(userId: nil, now: now),
              load(userId: nil).inviteConfirmed(pending.code, at: now) else { return nil }
        return pending
    }

    /// The person gave the invite up (Back from the join screen, or from the sign-in after it):
    /// forgets the pending code and the reader's confirmation, so the same link opened later
    /// shows the preview again and nothing joins on sign-in.
    public func giveUpInvite(userId: String?) throws {
        try pendingJoins.clear()
        try clearConfirmedInvite(userId: userId)
        if userId != nil {
            // A signed-in reader may still have the guest file's confirmation waiting to adopt.
            try clearConfirmedInvite(userId: nil)
        }
    }
}
