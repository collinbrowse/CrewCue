import Foundation
import Testing
@testable import CrewCueClientCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A tiny in-memory chat API: dedupes on (sender, clientMessageId) like the real one, and can be
/// taken down (no network), restarted, or told to lose the next response after storing it.
private actor FakeChatAPI: HTTPTransport {
    struct Stored {
        var id: Int
        var sender: String
        var clientMessageId: String
        var text: String
        var photoKey: String?
    }

    var messages: [Stored] = []
    var down = false
    var loseNextSendResponse = false
    var removed = false
    var nextId = 1
    let me = "crew-me"
    var postCount = 0

    func setDown(_ value: Bool) { down = value }
    func setRemoved(_ value: Bool) { removed = value }
    func loseNextResponse() { loseNextSendResponse = true }
    func post(from sender: String, text: String) {
        messages.append(Stored(id: nextId, sender: sender, clientMessageId: "srv-\(nextId)", text: text))
        nextId += 1
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if down { throw URLError(.notConnectedToInternet) }
        if removed { return json(403, ["error": "Not a member of this room"]) }
        let path = request.url.path
        guard path.hasPrefix("/chat/rooms/room-1/") else { return json(404, ["error": "Not found"]) }
        if path.hasSuffix("/photos") {
            return json(201, ["photoKey": "rooms/room-1/me/photo.jpg", "contentType": "image/jpeg", "byteSize": request.body?.count ?? 0])
        }
        if request.method == .post {
            postCount += 1
            let body = (try? JSONSerialization.jsonObject(with: request.body ?? Data()) as? [String: Any]) ?? [:]
            let clientId = body["clientMessageId"] as? String ?? ""
            let text = (body["text"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            if text.count > 4000 { return json(413, ["error": "Messages are limited to 4000 characters"]) }
            if let existing = messages.first(where: { $0.sender == me && $0.clientMessageId == clientId }) {
                return json(200, ["message": wire(existing), "duplicate": true])
            }
            let stored = Stored(id: nextId, sender: me, clientMessageId: clientId, text: text, photoKey: body["photoKey"] as? String)
            nextId += 1
            messages.append(stored)
            if loseNextSendResponse {
                loseNextSendResponse = false
                throw URLError(.networkConnectionLost)
            }
            return json(201, ["message": wire(stored), "duplicate": false])
        }
        let query = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let after = query.first { $0.name == "after" }.flatMap { Int($0.value ?? "") }
        let page = after.map { a in messages.filter { $0.id > a } } ?? Array(messages.suffix(50))
        let latest = page.last.map { String($0.id) } ?? (after.map(String.init) ?? "")
        return json(200, [
            "messages": page.map(wire),
            "members": [["userId": me, "displayName": "Pacer Collin"], ["userId": "ada", "displayName": "Ada"]],
            "selfUserId": me,
            "latestCursor": latest
        ])
    }

    private func wire(_ m: Stored) -> [String: Any] {
        var out: [String: Any] = [
            "id": String(m.id),
            "roomId": "room-1",
            "senderUserId": m.sender,
            "clientMessageId": m.clientMessageId,
            "text": m.text,
            "createdAt": "2026-11-09T12:00:00.000Z"
        ]
        if m.photoKey != nil {
            out["photo"] = ["url": "/chat/photos/x.jpg?exp=1&sig=a", "contentType": "image/jpeg", "byteSize": 3]
        }
        return out
    }

    private func json(_ status: Int, _ object: [String: Any]) -> HTTPResponse {
        HTTPResponse(status: status, body: (try? JSONSerialization.data(withJSONObject: object)) ?? Data())
    }
}

private func makeGraph(_ api: FakeChatAPI) throws -> ClientGraph {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let outbox = try OutboxStore.shared(userId: "crew-me", directory: UserStorage(root: directory).directory(userId: "crew-me"))
    return ClientGraph(
        transport: api,
        clock: SystemClock(),
        logger: NoopLogger(),
        baseURL: URL(string: "https://api.example.test"),
        tokenProvider: StaticTokenProvider(token: "t"),
        outbox: outbox
    )
}

private struct NoopLogger: Logger {
    func log(_ message: String) {}
}

@Test func chatOfflineMessagesGoOutOnceOnReconnect() async throws {
    let api = FakeChatAPI()
    let graph = try makeGraph(api)
    var thread = ChatThread(roomId: "room-1")
    let first = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: nil, failures: 0)
    thread.apply(try #require(first.page))

    await api.setDown(true)
    let a = try await ChatSync.send(graph: graph, roomId: "room-1", text: "queued 1", role: "crew_member")
    let b = try await ChatSync.send(graph: graph, roomId: "room-1", text: "queued 2", role: "crew_member")
    #expect(a.delivery == .queued)
    #expect(b.delivery == .queued)
    let offlineRows = thread.rows(pending: await ChatSync.pending(graph: graph, roomId: "room-1"), baseURL: graph.baseURL)
    #expect(offlineRows.map(\.text) == ["queued 1", "queued 2"])
    #expect(offlineRows.allSatisfy { $0.delivery == .queued && $0.isOwn && $0.author == "Pacer Collin (you)" })

    let failed = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: thread.pollCursor, failures: 0, waitSeconds: 0)
    #expect(failed.page == nil)
    #expect(failed.offline)
    #expect(failed.failures == 1)

    await api.setDown(false)
    let back = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: thread.pollCursor, failures: failed.failures, waitSeconds: 0)
    #expect(back.failures == 0)
    #expect(back.flushed?.accepted.count == 2)
    // Polling again and flushing again must not resend.
    _ = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: thread.pollCursor, failures: 1, waitSeconds: 0)
    _ = try await RaceDayAPI.flushOutbox(graph: graph)
    let stored = await api.messages
    #expect(stored.map(\.text) == ["queued 1", "queued 2"])
    #expect(await ChatSync.pending(graph: graph, roomId: "room-1").isEmpty)

    let page = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: thread.pollCursor, failures: 0, waitSeconds: 0)
    thread.apply(try #require(page.page))
    let rows = thread.rows(pending: [], baseURL: graph.baseURL)
    #expect(rows.map(\.text) == ["queued 1", "queued 2"])
    #expect(rows.allSatisfy { $0.delivery == .sent && $0.author == "Pacer Collin (you)" })
}

@Test func chatLostResponseIsNotSentTwice() async throws {
    let api = FakeChatAPI()
    let graph = try makeGraph(api)
    await api.loseNextResponse()
    let outcome = try await ChatSync.send(graph: graph, roomId: "room-1", text: "aid 3 in 20", role: "crew_member")
    #expect(outcome.delivery == .queued)
    // The retry reaches the server under the same client id; the server answers duplicate.
    let report = try await RaceDayAPI.flushOutbox(graph: graph)
    #expect(report.accepted == [outcome.operation.id])
    #expect(await api.messages.count == 1)
    #expect(await api.postCount == 2)
}

@Test func chatReconnectsAfterAnAPIRestart() async throws {
    let api = FakeChatAPI()
    let graph = try makeGraph(api)
    var thread = ChatThread(roomId: "room-1")
    await api.post(from: "ada", text: "leaving aid 2")
    thread.apply(try #require(await ChatSync.poll(graph: graph, roomId: "room-1", cursor: nil, failures: 0).page))
    #expect(thread.rows(pending: [], baseURL: nil).map(\.author) == ["Ada"])

    await api.setDown(true)
    var failures = 0
    var delays: [Int] = []
    for _ in 0..<4 {
        let outcome = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: thread.pollCursor, failures: failures, waitSeconds: 0)
        #expect(outcome.page == nil)
        #expect(outcome.stop == false)
        failures = outcome.failures
        delays.append(outcome.retryAfterSeconds)
    }
    #expect(delays == [1, 2, 4, 8])

    await api.setDown(false)
    await api.post(from: "ada", text: "at aid 3")
    let outcome = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: thread.pollCursor, failures: failures, waitSeconds: 0)
    thread.apply(try #require(outcome.page))
    #expect(outcome.failures == 0)
    #expect(outcome.retryAfterSeconds == 0)
    #expect(thread.rows(pending: [], baseURL: nil).map(\.text) == ["leaving aid 2", "at aid 3"])
}

@Test func chatStopsWhenTheMemberIsRemoved() async throws {
    let api = FakeChatAPI()
    let graph = try makeGraph(api)
    await api.setRemoved(true)
    let outcome = await ChatSync.poll(graph: graph, roomId: "room-1", cursor: "0", failures: 0, waitSeconds: 0)
    #expect(outcome.removed)
    #expect(outcome.stop)
    let send = try await ChatSync.send(graph: graph, roomId: "room-1", text: "still here?", role: "crew_member")
    #expect(send.delivery == .failed)
    let rows = ChatThread(roomId: "room-1").rows(pending: await ChatSync.pending(graph: graph, roomId: "room-1"), baseURL: nil)
    #expect(rows.first?.delivery == .failed)
    await ChatSync.discard(graph: graph, clientMessageId: send.operation.clientMessageId)
    #expect(await ChatSync.pending(graph: graph, roomId: "room-1").isEmpty)
}

@Test func chatTooLongIsRefusedNotRetried() async throws {
    let api = FakeChatAPI()
    let graph = try makeGraph(api)
    let send = try await ChatSync.send(graph: graph, roomId: "room-1", text: String(repeating: "x", count: 4001), role: "crew_member")
    #expect(send.delivery == .failed)
    _ = try await RaceDayAPI.flushOutbox(graph: graph)
    #expect(await api.postCount == 1)
}

@Test func chatPhotoUploadsThenSendsWithItsKey() async throws {
    let api = FakeChatAPI()
    let graph = try makeGraph(api)
    let key = try await ChatSync.uploadPhoto(graph: graph, roomId: "room-1", data: Data([1, 2, 3]), contentType: "image/jpeg")
    let sent = try await ChatSync.send(graph: graph, roomId: "room-1", text: "", photoKey: key, role: "crew_member")
    #expect(sent.delivery == .sent)
    var thread = ChatThread(roomId: "room-1")
    thread.apply(try #require(await ChatSync.poll(graph: graph, roomId: "room-1", cursor: nil, failures: 0).page))
    let row = try #require(thread.rows(pending: [], baseURL: graph.baseURL).first)
    #expect(row.photoURL?.absoluteString == "https://api.example.test/chat/photos/x.jpg?exp=1&sig=a")
}

@Test func chatThreadMergesOverlappingPagesById() throws {
    func page(_ ids: [Int], latest: String, older: String? = nil) -> ChatMessagePage {
        ChatMessagePage(
            messages: ids.map {
                ChatMessage(id: String($0), roomId: "r", senderUserId: "ada", clientMessageId: "c\($0)", text: "m\($0)", createdAt: "")
            },
            members: [ChatRoomMember(userId: "ada", displayName: "Ada")],
            selfUserId: "me",
            olderCursor: older,
            latestCursor: latest
        )
    }
    var thread = ChatThread(roomId: "r")
    thread.apply(page([8, 9, 10], latest: "10", older: "8"))
    thread.apply(page([10, 11], latest: "11"))
    thread.apply(page([6, 7], latest: "11", older: nil), older: true)
    #expect(thread.messages.map(\.id) == ["6", "7", "8", "9", "10", "11"])
    #expect(thread.latestCursor == "11")
    #expect(thread.olderCursor == nil)
    #expect(ChatThread(roomId: "r").pollCursor == "0")
}

@Test func chatReconnectDelaysCapAtThirtySeconds() {
    #expect((0...8).map(ChatReconnectPolicy.delaySeconds) == [0, 1, 2, 4, 8, 16, 30, 30, 30])
}
