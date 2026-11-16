import Foundation

/// Labels chat authors with their display name in the open race room.
///
/// Names live on each race-room membership, so one person can have a name in one race and none
/// in another. Authors resolve from the room roster the messages page returns. Nobody is ever
/// shown by their user id.
public struct ChatAuthors: Equatable, Sendable {
    /// Shown for a member with no name in this room, or a sender no longer on the roster.
    public static let unknown = "Crew member"
    /// Shown for the signed-in user's own messages when they have no name in this room.
    public static let you = "You"

    public let selfUserId: String
    /// Display names by user id. Members without a name in this room are left out.
    public let names: [String: String]

    public init(selfUserId: String, members: [ChatRoomMember]) {
        self.selfUserId = selfUserId
        var names: [String: String] = [:]
        for member in members {
            let name = member.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !name.isEmpty, names[member.userId] == nil else { continue }
            names[member.userId] = name
        }
        self.names = names
    }

    /// The label for the signed-in user's own messages: "Pacer Collin (you)", or "You".
    public var selfLabel: String {
        names[selfUserId].map { "\($0) (you)" } ?? Self.you
    }

    /// "Ada" for a named member, "Crew member" otherwise; the signed-in user gets `selfLabel`.
    public func label(userId: String) -> String {
        if userId == selfUserId { return selfLabel }
        return names[userId] ?? Self.unknown
    }
}
