import Foundation

/// How one transcript row reached the server.
public enum ChatDelivery: String, Sendable, Equatable {
    /// Stored on the server.
    case sent
    /// Queued on this device, not sent yet.
    case queued
    /// The server refused it for good (removed from the race, too long).
    case failed
}

/// One transcript row, ready for a screen.
public struct ChatRow: Identifiable, Equatable, Sendable {
    /// Server id for sent rows, the client message id for queued ones.
    public var id: String
    public var clientMessageId: String
    public var author: String
    public var text: String
    public var photoURL: URL?
    /// ISO-8601 from the server. Empty for queued rows.
    public var createdAt: String
    public var isOwn: Bool
    public var delivery: ChatDelivery

    public init(
        id: String,
        clientMessageId: String,
        author: String,
        text: String,
        photoURL: URL? = nil,
        createdAt: String = "",
        isOwn: Bool,
        delivery: ChatDelivery
    ) {
        self.id = id
        self.clientMessageId = clientMessageId
        self.author = author
        self.text = text
        self.photoURL = photoURL
        self.createdAt = createdAt
        self.isOwn = isOwn
        self.delivery = delivery
    }
}

/// One room's chat as the device knows it: server messages merged by id, plus messages still
/// in the outbox. Value type; screens keep one and feed it pages.
public struct ChatThread: Equatable, Sendable {
    public private(set) var roomId: String
    public private(set) var messages: [ChatMessage] = []
    public private(set) var authors: ChatAuthors
    /// Pass to the next long-poll. Empty until the first page.
    public private(set) var latestCursor: String = ""
    /// Pass as `before` to load older messages. Nil when there are none (or none loaded yet).
    public private(set) var olderCursor: String?
    public private(set) var loaded = false

    public init(roomId: String) {
        self.roomId = roomId
        self.authors = ChatAuthors(selfUserId: "", members: [])
    }

    /// Merges a page from `GET /chat/rooms/:roomId/messages`. Messages already held are replaced
    /// by id, so a page that overlaps an earlier one never duplicates a row.
    public mutating func apply(_ page: ChatMessagePage, older: Bool = false) {
        authors = ChatAuthors(selfUserId: page.selfUserId, members: page.members)
        var byId: [String: ChatMessage] = [:]
        for message in messages { byId[message.id] = message }
        for message in page.messages { byId[message.id] = message }
        messages = byId.values.sorted { Self.order($0.id) < Self.order($1.id) }
        if older || !loaded {
            olderCursor = page.olderCursor
        }
        if !older, !page.latestCursor.isEmpty, Self.order(page.latestCursor) >= Self.order(latestCursor) {
            latestCursor = page.latestCursor
        }
        loaded = true
    }

    /// The cursor for the next long-poll: the newest id seen, or "0" for an empty room.
    public var pollCursor: String {
        latestCursor.isEmpty ? "0" : latestCursor
    }

    /// Transcript rows oldest first. Queued outbox messages for this room follow the sent ones,
    /// unless the server already has them (same client message id from this user).
    public func rows(pending: [StoredOperation], baseURL: URL?) -> [ChatRow] {
        var rows = messages.map { message in
            ChatRow(
                id: message.id,
                clientMessageId: message.clientMessageId,
                author: authors.label(userId: message.senderUserId),
                text: message.text,
                photoURL: message.photo.flatMap { Self.resolve($0.url, baseURL: baseURL) },
                createdAt: message.createdAt,
                isOwn: message.senderUserId == authors.selfUserId,
                delivery: .sent
            )
        }
        let sentByMe = Set(messages.filter { $0.senderUserId == authors.selfUserId }.map(\.clientMessageId))
        for operation in pending where operation.type == "chat" && operation.roomId == roomId {
            guard !sentByMe.contains(operation.clientMessageId) else { continue }
            let draft = ChatOutboxPayload(json: operation.payloadJSON)
            rows.append(
                ChatRow(
                    id: operation.clientMessageId,
                    clientMessageId: operation.clientMessageId,
                    author: authors.selfLabel,
                    text: draft.text,
                    photoURL: nil,
                    isOwn: true,
                    delivery: Self.delivery(operation.status)
                )
            )
        }
        return rows
    }

    /// "accepted" is a send the server took that has not come back on a poll yet.
    static func delivery(_ status: String) -> ChatDelivery {
        switch status {
        case "pending": .queued
        case "accepted": .sent
        default: .failed
        }
    }

    /// True once the server has returned this client message id from the signed-in user.
    public func contains(clientMessageId: String) -> Bool {
        messages.contains { $0.senderUserId == authors.selfUserId && $0.clientMessageId == clientMessageId }
    }

    /// Photo URLs are absolute for bucket storage and an API path in local dev.
    static func resolve(_ raw: String, baseURL: URL?) -> URL? {
        if raw.hasPrefix("/") {
            guard let baseURL else { return nil }
            var root = baseURL.absoluteString
            if root.hasSuffix("/") { root.removeLast() }
            return URL(string: root + raw)
        }
        return URL(string: raw)
    }

    private static func order(_ id: String) -> Int64 {
        Int64(id) ?? -1
    }
}

/// What the outbox stores for one chat message.
public struct ChatOutboxPayload: Equatable, Sendable {
    public var text: String
    public var clientMessageId: String
    public var photoKey: String?

    public init(text: String, clientMessageId: String, photoKey: String? = nil) {
        self.text = text
        self.clientMessageId = clientMessageId
        self.photoKey = photoKey
    }

    init(json: String) {
        let object = json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        text = object["text"] as? String ?? ""
        clientMessageId = object["clientMessageId"] as? String ?? ""
        photoKey = object["photoKey"] as? String
    }
}

/// Backoff between chat polls after a failure: 1, 2, 4, 8, 16, then every 30 seconds.
public enum ChatReconnectPolicy {
    public static func delaySeconds(failures: Int) -> Int {
        guard failures > 0 else { return 0 }
        return min(30, 1 << min(failures - 1, 5))
    }
}

/// Chat status copy both apps show (checklist `clients/behavior/chat-thread.md`).
public enum ChatCopy {
    public static let empty = "No messages."
    public static let error = "Couldn't load chat."
    public static let offline = "Offline. Message queued on this device."
    public static let removed = "You're no longer on this race's crew."
    public static let expired = "Session expired. Sign in again."
    public static let photoNeedsConnection = "Photos need a connection."
    public static let photoTooLarge = "That photo is too large."
    public static let notSent = "Not sent"
    public static let queued = "Queued"
}
