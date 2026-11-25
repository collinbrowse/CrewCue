import Foundation
import Testing
@testable import CrewCueClientCore

private final class DeleteTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [HTTPRequest] = []
    private let respond: @Sendable () throws -> HTTPResponse

    init(_ respond: @escaping @Sendable () throws -> HTTPResponse) {
        self.respond = respond
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        lock.withLock { requests.append(request) }
        return try respond()
    }

    func seen() -> [HTTPRequest] {
        lock.withLock { requests }
    }
}

private func graph(_ transport: some HTTPTransport) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://api.example.test"),
        tokenProvider: StaticTokenProvider(token: "jwt"),
        outbox: nil
    )
}

@Test func deleteActivitySendsAuthorizedDeleteForTheRun() async throws {
    let transport = DeleteTransport { HTTPResponse(status: 204, body: Data()) }
    try await RaceDayAPI.deleteActivity(graph: graph(transport), id: "run-1")
    let request = try #require(transport.seen().first)
    #expect(transport.seen().count == 1)
    #expect(request.method == .delete)
    #expect(request.url.path == "/activity-history/run-1")
    #expect(request.headers["Authorization"] == "Bearer jwt")
}

@Test func deleteActivityTreatsAGoneRunAsRemovedAndThrowsOnFailure() async throws {
    let gone = DeleteTransport { HTTPResponse(status: 404, body: Data(#"{"error":"Activity history not found"}"#.utf8)) }
    try await RaceDayAPI.deleteActivity(graph: graph(gone), id: "run-1")

    for status in [401, 500] {
        let failing = DeleteTransport { HTTPResponse(status: status, body: Data(#"{"error":"no"}"#.utf8)) }
        await #expect(throws: ClientHTTPError.self) {
            try await RaceDayAPI.deleteActivity(graph: graph(failing), id: "run-1")
        }
    }
}

@Test func activityHistoryDeleteOutcomes() async {
    let ok = DeleteTransport { HTTPResponse(status: 204, body: Data()) }
    #expect(await ActivityHistoryDelete.run(graph: graph(ok), id: "run-1") == .removed)

    let offline = DeleteTransport { throw URLError(.notConnectedToInternet) }
    #expect(await ActivityHistoryDelete.run(graph: graph(offline), id: "run-1")
        == .failed(message: ActivityHistoryDelete.offlineMessage, offline: true))

    let broken = DeleteTransport { HTTPResponse(status: 500, body: Data()) }
    #expect(await ActivityHistoryDelete.run(graph: graph(broken), id: "run-1")
        == .failed(message: ActivityHistoryDelete.failureMessage, offline: false))

    let untouched = DeleteTransport { HTTPResponse(status: 204, body: Data()) }
    #expect(await ActivityHistoryDelete.run(graph: graph(untouched), id: "")
        == .failed(message: ActivityHistoryDelete.failureMessage, offline: false))
    #expect(untouched.seen().isEmpty)

    #expect(ActivityHistoryDelete.afterRemoval(canRecalculate: true) == ActivityHistoryDelete.recalculatePrompt)
    #expect(ActivityHistoryDelete.afterRemoval(canRecalculate: false) == ActivityHistoryDelete.removedMessage)
}

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

@Test func runtimeActivityDeleteOps() async throws {
    let copy = try #require(try await runtime(["op": "activityDeleteCopy"])["result"] as? [String: String])
    #expect(copy == ActivityHistoryDelete.copy)
    #expect(copy["confirmButton"] == "Remove run")

    let missingBase = try await runtime(["op": "deleteActivity", "id": "run-1"])
    #expect(missingBase["ok"] as? Bool == false)

    let unreachable = try #require(try await runtime([
        "op": "deleteActivity", "id": "run-1", "baseURL": "http://127.0.0.1:1", "token": "jwt"
    ])["result"] as? [String: Any])
    #expect(unreachable["removed"] as? Bool == false)
    #expect(unreachable["offline"] as? Bool == true)
    #expect(unreachable["message"] as? String == ActivityHistoryDelete.offlineMessage)
}
