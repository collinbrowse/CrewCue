import Foundation

/// Chat threads the Android app is showing, by user and room. Android keeps no chat state of its
/// own: it calls `chatPoll` in a loop and renders the rows each answer carries.
final class RuntimeChatThreads: @unchecked Sendable {
    struct Entry {
        var thread: ChatThread
        /// Sends the server took that have not come back on a poll yet.
        var recentlySent: [StoredOperation] = []
    }

    static let shared = RuntimeChatThreads()
    private let lock = NSLock()
    private var entries: [String: Entry] = [:]

    func read(_ key: String, roomId: String) -> Entry {
        lock.lock()
        defer { lock.unlock() }
        return entries[key] ?? Entry(thread: ChatThread(roomId: roomId))
    }

    func write(_ key: String, _ entry: Entry) {
        lock.lock()
        defer { lock.unlock() }
        entries[key] = entry
    }

    func reset(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        entries[key] = nil
    }
}

extension RuntimeCall {
    private static func chatKey(_ object: [String: Any], roomId: String) -> String {
        "\(object["userId"] as? String ?? "")|\(roomId)"
    }

    private static func chatRoom(_ object: [String: Any]) throws -> String {
        guard let roomId = text(object, "roomId") else {
            throw ClientHTTPError(status: 400, message: "roomId is required.")
        }
        return roomId
    }

    private static func rowJSON(_ row: ChatRow) -> [String: Any] {
        [
            "id": row.id,
            "clientMessageId": row.clientMessageId,
            "author": row.author,
            "text": row.text,
            "photoUrl": row.photoURL?.absoluteString ?? "",
            "createdAt": row.createdAt,
            "mine": row.isOwn,
            "delivery": row.delivery.rawValue
        ]
    }

    private static func chatRows(
        _ graph: ClientGraph,
        roomId: String,
        entry: inout RuntimeChatThreads.Entry
    ) async -> (rows: [ChatRow], json: [[String: Any]]) {
        entry.recentlySent.removeAll { entry.thread.contains(clientMessageId: $0.clientMessageId) }
        let pending = await ChatSync.pending(graph: graph, roomId: roomId)
        let rows = entry.thread.rows(pending: pending + entry.recentlySent, baseURL: graph.baseURL)
        return (rows, rows.map(rowJSON))
    }

    /// Same status line the iOS chat shows.
    static func chatStatus(rows: [ChatRow], loaded: Bool, offline: Bool, outcome: ChatPollOutcome?) -> String {
        if let outcome, outcome.removed { return ChatCopy.removed }
        if let outcome, outcome.expired { return ChatCopy.expired }
        if offline { return rows.contains { $0.delivery == .queued } ? ChatCopy.offline : "Offline." }
        if !loaded { return outcome == nil ? "" : ChatCopy.error }
        return rows.isEmpty ? ChatCopy.empty : ""
    }

    /// One step of the chat loop. `fresh: true` starts over (screen opened, race changed).
    static func chatPoll(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let roomId = try chatRoom(object)
        let key = chatKey(object, roomId: roomId)
        if boolValue(object["fresh"]) == true {
            RuntimeChatThreads.shared.reset(key)
        }
        var entry = RuntimeChatThreads.shared.read(key, roomId: roomId)
        let firstLoad = !entry.thread.loaded
        let known = Set(entry.thread.messages.map(\.id))
        let outcome = await ChatSync.poll(
            graph: graph,
            roomId: roomId,
            cursor: firstLoad ? nil : entry.thread.pollCursor,
            failures: intValue(object["failures"]) ?? 0,
            waitSeconds: intValue(object["wait"]) ?? ChatSync.waitSeconds
        )
        var fromOthers = 0
        if let page = outcome.page {
            entry.thread.apply(page)
            if !firstLoad {
                fromOthers = page.messages.filter { !known.contains($0.id) && $0.senderUserId != page.selfUserId }.count
            }
        }
        let (rows, json) = await chatRows(graph, roomId: roomId, entry: &entry)
        RuntimeChatThreads.shared.write(key, entry)
        let members = entry.thread.authors.names.map { ["userId": $0.key, "displayName": $0.value] }
        return [
            "rows": json,
            "members": members,
            "status": chatStatus(rows: rows, loaded: entry.thread.loaded, offline: outcome.offline, outcome: outcome),
            "failures": outcome.failures,
            "retryAfterSeconds": outcome.retryAfterSeconds,
            "offline": outcome.offline,
            "stop": outcome.stop,
            "hasOlder": entry.thread.olderCursor != nil,
            "newFromOthers": fromOthers
        ]
    }

    static func chatSend(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let roomId = try chatRoom(object)
        let key = chatKey(object, roomId: roomId)
        let body = object["text"] as? String ?? ""
        let photoKey = text(object, "photoKey")
        if body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && photoKey == nil {
            throw ClientHTTPError(status: 400, message: "A message needs text or a photo.")
        }
        let outcome = try await ChatSync.send(
            graph: graph,
            roomId: roomId,
            text: body,
            photoKey: photoKey,
            role: text(object, "role") ?? "crew_member",
            clientMessageId: text(object, "clientMessageId") ?? "chat-\(UUID().uuidString.lowercased())"
        )
        var entry = RuntimeChatThreads.shared.read(key, roomId: roomId)
        if outcome.delivery == .sent {
            var accepted = outcome.operation
            accepted.status = "accepted"
            entry.recentlySent.append(accepted)
        }
        let (rows, json) = await chatRows(graph, roomId: roomId, entry: &entry)
        RuntimeChatThreads.shared.write(key, entry)
        let offline = outcome.delivery == .queued
        return [
            "delivery": outcome.delivery.rawValue,
            "rows": json,
            "status": chatStatus(rows: rows, loaded: entry.thread.loaded, offline: offline, outcome: nil)
        ]
    }

    /// Uploads the image file at `path` (already a JPEG/PNG the app prepared) and returns its key.
    static func chatUploadPhoto(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let roomId = try chatRoom(object)
        guard let path = text(object, "path") else {
            throw ClientHTTPError(status: 400, message: "path is required.")
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let contentType = text(object, "contentType") ?? "image/jpeg"
        do {
            let key = try await ChatSync.uploadPhoto(graph: graph, roomId: roomId, data: data, contentType: contentType)
            return ["photoKey": key]
        } catch {
            if TransportFailure.isOffline(error) {
                throw ClientHTTPError(status: 0, message: "Offline. \(ChatCopy.photoNeedsConnection)")
            }
            if (error as? ClientHTTPError)?.status == 413 {
                throw ClientHTTPError(status: 413, message: ChatCopy.photoTooLarge)
            }
            throw error
        }
    }

    static func chatOlder(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let roomId = try chatRoom(object)
        let key = chatKey(object, roomId: roomId)
        var entry = RuntimeChatThreads.shared.read(key, roomId: roomId)
        if let cursor = entry.thread.olderCursor {
            let page = try await ChatSync.older(graph: graph, roomId: roomId, before: cursor)
            entry.thread.apply(page, older: true)
        }
        let (_, json) = await chatRows(graph, roomId: roomId, entry: &entry)
        RuntimeChatThreads.shared.write(key, entry)
        return ["rows": json, "hasOlder": entry.thread.olderCursor != nil]
    }

    static func chatDiscard(_ object: [String: Any]) async throws -> Any {
        let graph = try graph(object)
        let roomId = try chatRoom(object)
        let key = chatKey(object, roomId: roomId)
        if let id = text(object, "clientMessageId") {
            await ChatSync.discard(graph: graph, clientMessageId: id)
        }
        var entry = RuntimeChatThreads.shared.read(key, roomId: roomId)
        let (_, json) = await chatRows(graph, roomId: roomId, entry: &entry)
        RuntimeChatThreads.shared.write(key, entry)
        return ["rows": json]
    }
}
