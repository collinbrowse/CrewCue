import Foundation
import Observation
import CrewCueClientCore

struct ChatLine: Identifiable, Equatable {
    var id: String
    var text: String
    var author: String = ""
    var time: String = ""
    var mine: Bool = false
    /// "Queued" or "Not sent" for own messages that are not on the server yet.
    var delivery: String = ""
    var failed: Bool = false
    var imageURL: URL?
}

/// Crew chat for the active race. The loop lives here, not in the view, so the tab badge keeps
/// counting while another tab is open. Messages, paging, reconnect and the outbox come from
/// client-core `ChatSync` / `ChatThread`.
@MainActor
@Observable
final class ChatModel {
    var draft = ""

    private(set) var lines: [ChatLine] = []
    private(set) var unreadCount = 0
    private(set) var statusMessage = ""
    private(set) var isSending = false
    private(set) var isUploadingPhoto = false
    /// The thread is opening: no lines or status message yet.
    private(set) var opening = false
    private(set) var hasOlder = false

    private let client: AppClient
    private var thread = ChatThread(roomId: "")
    private var members: [MentionMember] = []
    private var roomId: String?
    private var role = ""
    private var generation = 0
    private var loop: Task<Void, Never>?
    private var offline = false
    private var visible = false
    private var seenIds: Set<String> = []
    /// Sent this session but not back from a poll yet, so the row does not blink out.
    private var recentlySent: [StoredOperation] = []

    private static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    init(client: AppClient) {
        self.client = client
    }

    var mentionNames: [String] {
        Mentions.parse(draft, members: members).compactMap { token in
            guard case .mention(let name, _) = token else { return nil }
            return name
        }
    }

    /// Starts (or keeps) the chat loop for this race. Same race: nothing restarts.
    func activate(userId: String?, roomId: String?, role: String?) {
        let nextRoom = Self.trimmed(roomId)
        self.role = role ?? ""
        guard userId != nil, let nextRoom else {
            stop()
            self.roomId = nil
            lines = []
            statusMessage = ChatCopy.empty
            opening = false
            return
        }
        if nextRoom == self.roomId, loop != nil { return }
        stop()
        generation += 1
        let ticket = generation
        self.roomId = nextRoom
        thread = ChatThread(roomId: nextRoom)
        members = []
        lines = []
        seenIds = []
        recentlySent = []
        unreadCount = 0
        statusMessage = ""
        opening = true
        offline = false
        loop = Task { [weak self] in
            await self?.run(roomId: nextRoom, ticket: ticket)
        }
    }

    /// The chat screen is on screen: its messages count as read.
    func setVisible(_ value: Bool) {
        visible = value
        if value { unreadCount = 0 }
    }

    func clear() {
        stop()
        generation += 1
        draft = ""
        lines = []
        members = []
        thread = ChatThread(roomId: "")
        statusMessage = ""
        opening = false
        roomId = nil
        role = ""
        isSending = false
        isUploadingPhoto = false
        unreadCount = 0
        seenIds = []
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending, let roomId else { return }
        let ticket = generation
        isSending = true
        defer { isSending = false }
        draft = ""
        do {
            let outcome = try await ChatSync.send(graph: client.graph, roomId: roomId, text: text, role: sendRole)
            guard ticket == generation else { return }
            offline = outcome.delivery == .queued
            noteSent(outcome)
        } catch {
            guard ticket == generation else { return }
            draft = text
            statusMessage = ChatCopy.error
            return
        }
        await refreshLines()
    }

    /// Uploads a JPEG/PNG/HEIC and sends it as its own message.
    func sendPhoto(data: Data, contentType: String) async {
        guard let roomId, !isUploadingPhoto else { return }
        let ticket = generation
        isUploadingPhoto = true
        defer { isUploadingPhoto = false }
        do {
            let key = try await ChatSync.uploadPhoto(graph: client.graph, roomId: roomId, data: data, contentType: contentType)
            guard ticket == generation else { return }
            let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            draft = ""
            let outcome = try await ChatSync.send(graph: client.graph, roomId: roomId, text: caption, photoKey: key, role: sendRole)
            guard ticket == generation else { return }
            noteSent(outcome)
        } catch {
            guard ticket == generation else { return }
            if APIFailure.isOffline(error) {
                statusMessage = ChatCopy.photoNeedsConnection
            } else if (error as? ClientHTTPError)?.status == 413 {
                statusMessage = ChatCopy.photoTooLarge
            } else {
                statusMessage = ChatCopy.error
            }
            return
        }
        await refreshLines()
    }

    /// Removes a message the server refused from the outbox.
    func discard(_ line: ChatLine) async {
        await ChatSync.discard(graph: client.graph, clientMessageId: line.id)
        await refreshLines()
    }

    func loadOlder() async {
        guard let roomId, let cursor = thread.olderCursor else { return }
        let ticket = generation
        guard let page = try? await ChatSync.older(graph: client.graph, roomId: roomId, before: cursor), ticket == generation else {
            return
        }
        thread.apply(page, older: true)
        await refreshLines()
    }

    private func noteSent(_ outcome: ChatSendOutcome) {
        guard outcome.delivery == .sent else { return }
        var accepted = outcome.operation
        accepted.status = "accepted"
        recentlySent.append(accepted)
    }

    private var sendRole: String {
        role.isEmpty ? "crew_member" : role
    }

    private func stop() {
        loop?.cancel()
        loop = nil
    }

    private func run(roomId: String, ticket: Int) async {
        var cursor: String?
        var failures = 0
        while !Task.isCancelled, ticket == generation {
            let outcome = await ChatSync.poll(graph: client.graph, roomId: roomId, cursor: cursor, failures: failures)
            guard !Task.isCancelled, ticket == generation else { return }
            failures = outcome.failures
            offline = outcome.offline
            if let page = outcome.page {
                let firstLoad = cursor == nil
                thread.apply(page)
                cursor = thread.pollCursor
                members = page.members.compactMap { member in
                    guard let name = member.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
                    return MentionMember(userId: member.userId, displayName: name)
                }
                countUnread(page, firstLoad: firstLoad)
            }
            opening = false
            await refreshLines()
            guard ticket == generation else { return }
            if outcome.stop {
                statusMessage = outcome.removed ? ChatCopy.removed : ChatCopy.expired
                loop = nil
                return
            }
            if outcome.page == nil, !thread.loaded, !outcome.offline {
                statusMessage = ChatCopy.error
            }
            if outcome.retryAfterSeconds > 0 {
                try? await Task.sleep(for: .seconds(outcome.retryAfterSeconds))
            }
        }
    }

    private func countUnread(_ page: ChatMessagePage, firstLoad: Bool) {
        let fresh = page.messages.filter { !seenIds.contains($0.id) }
        seenIds.formUnion(page.messages.map(\.id))
        guard !firstLoad, !visible else { return }
        unreadCount += fresh.filter { $0.senderUserId != page.selfUserId }.count
    }

    private func refreshLines() async {
        guard let roomId else { return }
        recentlySent.removeAll { thread.contains(clientMessageId: $0.clientMessageId) }
        let pending = await ChatSync.pending(graph: client.graph, roomId: roomId)
        let rows = thread.rows(pending: pending + recentlySent, baseURL: client.graph.baseURL)
        lines = rows.map { row in
            ChatLine(
                id: row.id,
                text: row.text,
                author: row.author,
                time: Self.time(row.createdAt),
                mine: row.isOwn,
                delivery: row.delivery == .queued ? ChatCopy.queued : row.delivery == .failed ? ChatCopy.notSent : "",
                failed: row.delivery == .failed,
                imageURL: row.photoURL
            )
        }
        hasOlder = thread.olderCursor != nil
        if statusMessage == ChatCopy.removed || statusMessage == ChatCopy.expired { return }
        let queued = rows.contains { $0.delivery == .queued }
        if offline {
            statusMessage = queued ? ChatCopy.offline : "Offline."
        } else if thread.loaded {
            statusMessage = lines.isEmpty ? ChatCopy.empty : ""
        }
    }

    private static func time(_ iso: String) -> String {
        guard !iso.isEmpty, let date = Self.iso.date(from: iso) else { return "" }
        return clock.string(from: date)
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}
