import Foundation

/// Result of one step of the chat loop.
public struct ChatPollOutcome: Sendable {
    /// Messages to merge into the thread. Nil when the request failed.
    public var page: ChatMessagePage?
    /// Consecutive failures including this one; 0 after a success.
    public var failures: Int
    /// Wait this long before the next poll. 0 means poll again now.
    public var retryAfterSeconds: Int
    public var offline: Bool
    /// The caller is no longer a member (or the race is gone). Stop polling.
    public var removed: Bool
    /// The session expired (401). Stop polling; the app signs out.
    public var expired: Bool
    /// Set when this poll also sent queued chat (first load or reconnect).
    public var flushed: FlushReport?

    public var stop: Bool { removed || expired }
}

public struct ChatSendOutcome: Sendable {
    public var operation: StoredOperation
    /// "sent", "queued", or "failed".
    public var delivery: ChatDelivery
    /// User-facing reason when `delivery` is failed.
    public var feedback: String?
}

/// The chat loop both apps run: load the newest page, then long-poll after the newest id.
/// Queued messages go out through the outbox (stable client message ids, so exactly once) on
/// open, on reconnect, and right after each send.
public enum ChatSync {
    public static let waitSeconds = 25
    public static let pageSize = 50
    /// How long past the long-poll wait a read may take before it counts as a dropped connection.
    public static let deadlineSlackSeconds = 15

    /// One step. With `cursor` nil this loads the newest page at once; otherwise it waits up to
    /// `waitSeconds` for messages newer than `cursor`.
    public static func poll(
        graph: ClientGraph,
        roomId: String,
        cursor: String?,
        failures: Int,
        waitSeconds: Int = ChatSync.waitSeconds,
        deadlineSeconds: Double? = nil
    ) async -> ChatPollOutcome {
        do {
            let wait = cursor == nil ? nil : waitSeconds
            // A dead connection must not hold the loop: give up a little after the server would answer.
            let deadline = deadlineSeconds ?? Double((wait ?? 0) + deadlineSlackSeconds)
            let page = try await Deadline.run(seconds: deadline) {
                try await RaceDayAPI.chatMessages(
                    graph: graph,
                    roomId: roomId,
                    after: cursor,
                    limit: pageSize,
                    waitSeconds: wait
                )
            }
            var flushed: FlushReport?
            let queued = await hasQueuedChat(graph: graph, roomId: roomId)
            if cursor == nil || failures > 0 || queued {
                flushed = try? await RaceDayAPI.flushOutbox(graph: graph)
            }
            return ChatPollOutcome(
                page: page,
                failures: 0,
                retryAfterSeconds: 0,
                offline: false,
                removed: false,
                expired: flushed?.sessionExpired == true,
                flushed: flushed
            )
        } catch {
            let http = error as? ClientHTTPError
            let next = failures + 1
            return ChatPollOutcome(
                page: nil,
                failures: next,
                retryAfterSeconds: ChatReconnectPolicy.delaySeconds(failures: next),
                offline: TransportFailure.isOffline(error) || http?.status == 0,
                removed: http?.status == 403 || http?.status == 404,
                expired: http?.status == 401,
                flushed: nil
            )
        }
    }

    /// Older messages before `cursor`, for scrolling up.
    public static func older(graph: ClientGraph, roomId: String, before cursor: String) async throws -> ChatMessagePage {
        try await RaceDayAPI.chatMessages(graph: graph, roomId: roomId, before: cursor, limit: pageSize)
    }

    /// Queues the message and tries to send it now. Offline, it stays queued and goes out on the
    /// next successful poll.
    public static func send(
        graph: ClientGraph,
        roomId: String,
        text: String,
        photoKey: String? = nil,
        role: String,
        clientMessageId: String = "chat-\(UUID().uuidString.lowercased())"
    ) async throws -> ChatSendOutcome {
        guard let outbox = graph.outbox else {
            throw ClientHTTPError(status: 0, message: "Outbox is not configured.")
        }
        let operation = try await outbox.enqueueChat(
            roomId: roomId,
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            clientMessageId: clientMessageId,
            role: role,
            photoKey: photoKey
        )
        let report: FlushReport
        do {
            report = try await RaceDayAPI.flushOutbox(graph: graph)
        } catch {
            return ChatSendOutcome(operation: operation, delivery: .queued, feedback: nil)
        }
        if report.accepted.contains(operation.id) {
            return ChatSendOutcome(operation: operation, delivery: .sent, feedback: nil)
        }
        if report.rejected.contains(operation.id) {
            let stored = try? await outbox.operations().first { $0.id == operation.id }
            return ChatSendOutcome(operation: stored ?? operation, delivery: .failed, feedback: "Couldn't send this message.")
        }
        return ChatSendOutcome(operation: operation, delivery: .queued, feedback: nil)
    }

    /// Uploads a photo (JPEG, PNG, HEIC or WebP, 10 MB at most) and returns its key for `send`.
    /// Photos need a connection; they are not queued.
    public static func uploadPhoto(graph: ClientGraph, roomId: String, data: Data, contentType: String) async throws -> String {
        try await RaceDayAPI.uploadChatPhoto(graph: graph, roomId: roomId, data: data, contentType: contentType).photoKey
    }

    /// This room's chat still in the outbox (queued or refused), oldest first.
    public static func pending(graph: ClientGraph, roomId: String) async -> [StoredOperation] {
        let all = (try? await graph.outbox?.operations()) ?? []
        return all.filter { $0.type == "chat" && $0.roomId == roomId }
    }

    /// Drops a refused message from the outbox.
    public static func discard(graph: ClientGraph, clientMessageId: String) async {
        try? await graph.outbox?.complete(id: clientMessageId)
    }

    private static func hasQueuedChat(graph: ClientGraph, roomId: String) async -> Bool {
        await pending(graph: graph, roomId: roomId).contains { $0.status == "pending" }
    }
}
