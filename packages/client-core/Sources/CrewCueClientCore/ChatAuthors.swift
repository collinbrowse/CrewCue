import Foundation

/// Labels chat authors with their display name in the open race room.
///
/// Stream keeps one global name per user, but CrewCue names live on each room membership,
/// so a name from one race would otherwise show in another. Authors resolve from the room
/// roster that `/chat/stream-token` returns. Nobody is ever shown by their Stream id.
public struct ChatAuthors: Equatable, Sendable {
    /// Shown for a member with no name in this room, or a sender no longer on the roster.
    public static let unknown = "Crew member"
    /// Shown for the signed-in user's own messages when they have no name in this room.
    public static let you = "You"

    public let selfStreamUserId: String
    /// Display names by Stream user id. Members without a name in this room are left out.
    public let names: [String: String]

    public init(selfStreamUserId: String, members: [ChatStreamMember]?) {
        self.selfStreamUserId = selfStreamUserId
        var names: [String: String] = [:]
        for member in members ?? [] {
            let name = member.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !name.isEmpty, names[member.streamUserId] == nil else { continue }
            names[member.streamUserId] = name
        }
        self.names = names
    }

    public init(token: ChatStreamTokenResponse) {
        self.init(selfStreamUserId: token.streamUserId, members: token.members)
    }

    /// The label for the signed-in user's own messages: "Pacer Collin (you)", or "You".
    public var selfLabel: String {
        names[selfStreamUserId].map { "\($0) (you)" } ?? Self.you
    }

    /// "Ada" for a named member, "Crew member" otherwise; the signed-in user gets `selfLabel`.
    public func label(streamUserId: String) -> String {
        if streamUserId == selfStreamUserId { return selfLabel }
        return names[streamUserId] ?? Self.unknown
    }
}
