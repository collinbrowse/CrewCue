import Foundation
import CrewCueClientCore

enum StreamChannelFailure: Error, Sendable {
    case notLinked
    case notOpen
}

#if canImport(StreamChat)
import StreamChat
#endif

/// Opens crew-{roomId} when Stream Chat is linked. The composer still works when it is not.
@MainActor
final class StreamRoomSession {
    private(set) var isOpen = false
    private var epoch = 0
    private static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()

    #if canImport(StreamChat)
    private var client: ChatClient?
    private var chat: Chat?
    #endif

    func close() async {
        epoch += 1
        isOpen = false
        #if canImport(StreamChat)
        let existing = client
        client = nil
        chat = nil
        await existing?.disconnect()
        #endif
    }

    func open(
        apiKey: String,
        streamUserId: String,
        displayName: String?,
        channelId: String,
        refreshToken: @escaping @Sendable () async throws -> String
    ) async throws {
        #if canImport(StreamChat)
        let ticket = epoch + 1
        epoch = ticket
        let previous = client
        client = nil
        chat = nil
        isOpen = false
        await previous?.disconnect()
        guard epoch == ticket else { throw StreamChannelFailure.notOpen }
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty, !channelId.isEmpty else { throw StreamChannelFailure.notLinked }
        var config = ChatClientConfig(apiKeyString: trimmedKey)
        if let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            config.localStorageFolderURL = base.appendingPathComponent("crewcue-stream-\(streamUserId)", isDirectory: true)
        }
        let nextClient = ChatClient(config: config)
        let provider: TokenProvider = { completion in
            Task {
                do {
                    let raw = try await refreshToken()
                    let token = try Token(rawValue: raw)
                    completion(.success(token))
                } catch {
                    completion(.failure(error))
                }
            }
        }
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let visibleName = (name?.isEmpty == false) ? name : nil
        try await nextClient.connectUser(
            userInfo: UserInfo(id: streamUserId, name: visibleName),
            tokenProvider: provider
        )
        guard epoch == ticket else {
            await nextClient.disconnect()
            throw StreamChannelFailure.notOpen
        }
        let room = nextClient.makeChat(for: ChannelId(type: .messaging, id: channelId))
        try await room.get(watch: true)
        guard epoch == ticket else {
            await nextClient.disconnect()
            throw StreamChannelFailure.notOpen
        }
        client = nextClient
        chat = room
        isOpen = true
        #else
        _ = apiKey
        _ = streamUserId
        _ = displayName
        _ = channelId
        _ = refreshToken
        throw StreamChannelFailure.notLinked
        #endif
    }

    func lines(authors: ChatAuthors) -> [ChatLine] {
        #if canImport(StreamChat)
        guard let chat else { return [] }
        return chat.state.messages.compactMap { message in
            let image = message.imageAttachments.first?.imageURL.absoluteString
            let reactions = message.reactionScores
                .map { "\($0.key.rawValue) \($0.value)" }
                .sorted()
                .joined(separator: " ")
            let body = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty || image != nil || !reactions.isEmpty else { return nil }
            // Stream's user name is global; names are per race, so label from this room's roster.
            return ChatLine(
                id: message.id,
                text: body,
                author: message.isSentByCurrentUser ? authors.selfLabel : authors.label(streamUserId: message.author.id),
                time: Self.clock.string(from: message.createdAt),
                mine: message.isSentByCurrentUser,
                reactions: reactions,
                imageURL: image
            )
        }
        #else
        _ = authors
        return []
        #endif
    }

    func unreadCount() -> Int {
        #if canImport(StreamChat)
        chat?.state.channel?.unreadCount.messages ?? 0
        #else
        0
        #endif
    }

    func send(text: String, messageId: String) async throws {
        #if canImport(StreamChat)
        guard let chat, isOpen else { throw StreamChannelFailure.notOpen }
        _ = try await chat.sendMessage(with: text, messageId: messageId)
        #else
        _ = text
        _ = messageId
        throw StreamChannelFailure.notLinked
        #endif
    }
}
