import Foundation
import Observation
import CrewCueClientCore

private enum ChatOutboxAppend {
    static func append(_ operation: StoredOperation, to outbox: OutboxStore, roomId: String) async throws {
        try await outbox.mutate(roomId: roomId, type: "chat") { operations in
            operations.append(operation)
        }
    }
}

struct ChatLine: Identifiable, Equatable {
    var id: String
    var text: String
}

@MainActor
@Observable
final class ChatModel {
    var draft = ""

    private(set) var lines: [ChatLine] = []
    private(set) var channelId = ""
    private(set) var statusMessage = ""
    private(set) var isSending = false

    private let client: AppClient
    private let session = StreamRoomSession()
    private var members: [MentionMember] = []
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
        lines = []
        openWasOffline = false
        await session.close()
        guard ticket == generation, !Task.isCancelled else { return }
        guard userId != nil, let nextRoom else {
            statusMessage = "No messages."
            return
        }
        await loadMembers(roomId: nextRoom, ticket: ticket)
        guard ticket == generation, !Task.isCancelled else { return }
        do {
            let minted = try await RaceDayAPI.streamToken(graph: client.graph, roomId: nextRoom)
            guard ticket == generation, !Task.isCancelled else { return }
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
        channelId = ""
        statusMessage = ""
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
        let payload = Self.payloadJSON(text: text, clientMessageId: clientMessageId)
        let operation = StoredOperation(
            id: clientMessageId,
            type: "chat",
            conflictKey: "chat:\(clientMessageId)",
            roomId: roomId,
            payloadJSON: payload,
            idempotencyKey: IdempotencyKey.hashPayload(payload),
            clientMessageId: clientMessageId,
            role: role.isEmpty ? "crew" : role
        )
        do {
            try await ChatOutboxAppend.append(operation, to: outbox, roomId: roomId)
        } catch {
            guard ticket == generation else { return }
            statusMessage = "Couldn't open the channel."
            return
        }
        guard ticket == generation else { return }
        draft = ""
        guard session.isOpen else {
            await showChannelResult(ticket: ticket, opened: false)
            return
        }
        do {
            try await session.send(text: text, messageId: clientMessageId)
            try await outbox.complete(id: clientMessageId)
            guard ticket == generation else { return }
            openWasOffline = false
            await showChannelResult(ticket: ticket, opened: true)
            guard ticket == generation else { return }
            if lines.contains(where: { $0.id == clientMessageId }) == false {
                lines.append(ChatLine(id: clientMessageId, text: text))
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

    private func deliverPending(roomId: String, ticket: Int) async -> Bool {
        guard session.isOpen, !isSending, let outbox = client.graph.outbox else { return false }
        let operations = (try? await outbox.operations()) ?? []
        let pending = operations.filter { $0.roomId == roomId && $0.type == "chat" && $0.status == "pending" }
        guard !pending.isEmpty else { return false }
        isSending = true
        defer {
            if ticket == generation {
                isSending = false
            }
        }
        for operation in pending {
            guard ticket == generation, session.isOpen else { return true }
            let text = Self.text(in: operation.payloadJSON)
            guard !text.isEmpty else { continue }
            do {
                try await session.send(text: text, messageId: operation.clientMessageId)
                try await outbox.complete(id: operation.id)
            } catch {
                if APIFailure.isOffline(error) {
                    openWasOffline = true
                }
                return true
            }
        }
        return false
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
        var next = session.lines()
        var pending = false
        if let roomId, let outbox = client.graph.outbox {
            let operations = (try? await outbox.operations()) ?? []
            let known = Set(next.map(\.id))
            for operation in operations where operation.roomId == roomId && operation.type == "chat" && operation.status == "pending" {
                pending = true
                guard !known.contains(operation.id) else { continue }
                let text = Self.text(in: operation.payloadJSON)
                guard !text.isEmpty else { continue }
                next.append(ChatLine(id: operation.id, text: text))
            }
        }
        lines = next.filter { !$0.text.isEmpty }
        return pending
    }

    private static func payloadJSON(text: String, clientMessageId: String) -> String {
        let object: [String: Any] = ["text": text, "clientMessageId": clientMessageId]
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
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
