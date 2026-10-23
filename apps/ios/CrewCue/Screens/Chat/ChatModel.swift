import Foundation
import Observation
import CrewCueClientCore

private struct ChatDeliveryStopped: Error {}

struct ChatLine: Identifiable, Equatable {
    var id: String
    var text: String
    var author: String = ""
    var time: String = ""
    var mine: Bool = false
    var reactions: String = ""
    var imageURL: String?
}

@MainActor
@Observable
final class ChatModel {
    var draft = ""

    private(set) var lines: [ChatLine] = []
    private(set) var unreadCount = 0
    private(set) var channelId = ""
    private(set) var statusMessage = ""
    private(set) var isSending = false
    /// The thread is opening: no lines or status message yet.
    private(set) var opening = false

    private let client: AppClient
    private let session = StreamRoomSession()
    private var members: [MentionMember] = []
    private var authors = ChatAuthors(selfStreamUserId: "", members: nil)
    private var roomId: String?
    private var role = ""
    private var generation = 0
    private var openWasOffline = false

    init(client: AppClient) {
        self.client = client
    }

    var mentionNames: [String] {
        Mentions.parse(draft, members: members).compactMap { token in
            guard case .mention(let name, _) = token else { return nil }
            return name
        }
    }

    func activate(userId: String?, roomId: String?, role: String?, displayName: String?) async {
        generation += 1
        let ticket = generation
        let nextRoom = Self.trimmed(roomId)
        self.roomId = nextRoom
        self.role = role ?? ""
        channelId = nextRoom.map { RaceDayAPI.channelId(roomId: $0) } ?? ""
        members = []
        authors = ChatAuthors(selfStreamUserId: "", members: nil)
        lines = []
        statusMessage = ""
        opening = true
        openWasOffline = false
        await session.close()
        guard ticket == generation, !Task.isCancelled else { return }
        guard userId != nil, let nextRoom else {
            statusMessage = "No messages."
            opening = false
            return
        }
        await loadMembers(roomId: nextRoom, ticket: ticket)
        guard ticket == generation, !Task.isCancelled else { return }
        do {
            let minted = try await RaceDayAPI.streamToken(graph: client.graph, roomId: nextRoom)
            guard ticket == generation, !Task.isCancelled else { return }
            authors = ChatAuthors(token: minted)
            let graph = client.graph
            try await session.open(
                apiKey: minted.streamApiKey,
                streamUserId: minted.streamUserId,
                displayName: displayName,
                channelId: channelId,
                refreshToken: {
                    let next = try await RaceDayAPI.streamToken(graph: graph, roomId: nextRoom)
                    return next.token
                }
            )
            guard ticket == generation, !Task.isCancelled else { return }
            openWasOffline = false
            let sendFailed = await deliverPending(roomId: nextRoom, ticket: ticket)
            guard ticket == generation, !Task.isCancelled else { return }
            await showChannelResult(ticket: ticket, opened: !sendFailed)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            openWasOffline = APIFailure.isOffline(error)
            await showChannelResult(ticket: ticket, opened: false)
        }
    }

    func clear() {
        generation += 1
        draft = ""
        lines = []
        members = []
        authors = ChatAuthors(selfStreamUserId: "", members: nil)
        channelId = ""
        statusMessage = ""
        opening = false
        roomId = nil
        role = ""
        openWasOffline = false
        isSending = false
        Task { await session.close() }
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        let ticket = generation
        guard let roomId else {
            statusMessage = "Couldn't open the channel."
            return
        }
        guard let outbox = client.graph.outbox else {
            statusMessage = "Couldn't open the channel."
            return
        }
        isSending = true
        defer { isSending = false }
        let clientMessageId = UUID().uuidString
        do {
            _ = try await outbox.enqueueChat(
                roomId: roomId,
                text: text,
                clientMessageId: clientMessageId,
                role: role.isEmpty ? "crew" : role
            )
        } catch {
            guard ticket == generation else { return }
            statusMessage = "Couldn't open the channel."
            return
        }
        guard ticket == generation else { return }
        draft = ""
        guard session.isOpen, (try? await outbox.claimChat(id: clientMessageId)) == true else {
            await showChannelResult(ticket: ticket, opened: false)
            return
        }
        do {
            try await sendClaimed(text: text, clientMessageId: clientMessageId, outbox: outbox)
            guard ticket == generation else { return }
            openWasOffline = false
            await showChannelResult(ticket: ticket, opened: true)
            guard ticket == generation else { return }
            if lines.contains(where: { $0.id == clientMessageId }) == false {
                lines.append(ChatLine(id: clientMessageId, text: text, author: authors.selfLabel, mine: true))
                statusMessage = ""
            }
        } catch {
            guard ticket == generation else { return }
            let offline = APIFailure.isOffline(error)
            if offline {
                openWasOffline = true
            }
            _ = await refreshLines()
            guard ticket == generation else { return }
            statusMessage = offline
                ? "Offline. Message queued on this device."
                : "Couldn't open the channel."
        }
    }

    /// Sends one claimed message under its stable id. Stream answering "already exists" means an
    /// earlier attempt landed (a crash or lost reply), so it counts as delivered.
    private func sendClaimed(text: String, clientMessageId: String, outbox: OutboxStore) async throws {
        do {
            try await session.send(text: text, messageId: clientMessageId)
        } catch {
            try? await outbox.settleChat(id: clientMessageId, error: error)
            if OutboxPolicy.isAlreadyDelivered(error) { return }
            throw error
        }
        try await outbox.settleChat(id: clientMessageId, error: nil)
    }

    /// Redelivers this room's queued messages, including ones a crash left behind. Each message is
    /// claimed in memory first, so a send already in progress is never sent twice.
    private func deliverPending(roomId: String, ticket: Int) async -> Bool {
        guard session.isOpen, !isSending, let outbox = client.graph.outbox else { return false }
        let pending = (try? await outbox.claimPendingChat(roomId: roomId)) ?? []
        guard !pending.isEmpty else { return false }
        isSending = true
        defer {
            if ticket == generation {
                isSending = false
            }
        }
        for (index, operation) in pending.enumerated() {
            guard ticket == generation, session.isOpen else {
                await release(pending[index...], outbox: outbox)
                return true
            }
            let text = Self.text(in: operation.payloadJSON)
            guard !text.isEmpty else {
                await release(pending[index...index], outbox: outbox)
                continue
            }
            do {
                try await sendClaimed(text: text, clientMessageId: operation.clientMessageId, outbox: outbox)
            } catch {
                if APIFailure.isOffline(error) {
                    openWasOffline = true
                }
                await release(pending[(index + 1)...], outbox: outbox)
                return true
            }
        }
        return false
    }

    /// Gives claimed messages back to the queue without sending them.
    private func release(_ operations: ArraySlice<StoredOperation>, outbox: OutboxStore) async {
        for operation in operations {
            try? await outbox.settleChat(id: operation.id, error: ChatDeliveryStopped())
        }
    }

    private func loadMembers(roomId: String, ticket: Int) async {
        do {
            let envelope = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId)
            guard ticket == generation else { return }
            members = envelope.room.memberships.compactMap { membership in
                let name = membership.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard !name.isEmpty else { return nil }
                return MentionMember(userId: membership.userId, displayName: name)
            }
        } catch {
            guard ticket == generation else { return }
            members = []
        }
    }

    private func showChannelResult(ticket: Int, opened: Bool) async {
        let pending = await refreshLines()
        guard ticket == generation else { return }
        opening = false
        if opened {
            statusMessage = lines.isEmpty ? "No messages." : ""
            return
        }
        if openWasOffline && pending {
            statusMessage = "Offline. Message queued on this device."
        } else {
            statusMessage = "Couldn't open the channel."
        }
    }

    @discardableResult
    private func refreshLines() async -> Bool {
        var next = session.lines(authors: authors)
        var pending = false
        if let roomId, let outbox = client.graph.outbox {
            let operations = (try? await outbox.operations()) ?? []
            let known = Set(next.map(\.id))
            for operation in operations where operation.roomId == roomId && operation.type == "chat" && operation.status == "pending" {
                pending = true
                guard !known.contains(operation.id) else { continue }
                let text = Self.text(in: operation.payloadJSON)
                guard !text.isEmpty else { continue }
                next.append(ChatLine(id: operation.id, text: text, author: authors.selfLabel, mine: true))
            }
        }
        unreadCount = session.unreadCount()
        lines = next.filter { line in
            !line.text.isEmpty || line.imageURL != nil || !line.reactions.isEmpty
        }
        return pending
    }

    private static func text(in payload: String) -> String {
        guard let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let text = object["text"] as? String else {
            return ""
        }
        return text
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}
