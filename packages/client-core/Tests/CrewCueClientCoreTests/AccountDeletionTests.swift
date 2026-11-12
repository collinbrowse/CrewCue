import Foundation
import Testing
@testable import CrewCueClientCore

private let deletedBody = Data(#"""
{"deleted":true,"roomsClosed":1,"membershipsRemoved":0,"activityHistoryDeleted":2,"pacingEstimatesDeleted":1,
 "finishedEffortsDeleted":0,"pushDevicesDeleted":1,"chatPrefsDeleted":0,"stravaDisconnected":true,"identityProvider":"deleted"}
"""#.utf8)

private final class DeletionTransport: HTTPTransport, @unchecked Sendable {
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

@Test func deleteAccountSendsAuthorizedDeleteMeAndReportsDeleted() async throws {
    let transport = DeletionTransport { HTTPResponse(status: 200, body: deletedBody) }
    let outcome = await AccountDeletion.run(graph: graph(transport))
    #expect(outcome == .deleted(identityProvider: "deleted"))
    let request = try #require(transport.seen().first)
    #expect(request.method == .delete)
    #expect(request.url.path == "/me")
    #expect(request.headers["Authorization"] == "Bearer jwt")
}

@Test func deleteAccountFailuresKeepTheUserSignedIn() async {
    let offline = await AccountDeletion.run(graph: graph(DeletionTransport { throw URLError(.notConnectedToInternet) }))
    #expect(offline == .failed(message: AccountDeletion.offlineMessage, retryable: true))

    let identity = await AccountDeletion.run(graph: graph(DeletionTransport {
        HTTPResponse(status: 502, body: Data(#"{"code":"identity_delete_failed","retryable":true}"#.utf8))
    }))
    #expect(identity == .failed(message: AccountDeletion.identityFailedMessage, retryable: true))

    let server = await AccountDeletion.run(graph: graph(DeletionTransport { HTTPResponse(status: 500, body: Data("{}".utf8)) }))
    #expect(server == .failed(message: AccountDeletion.genericFailureMessage, retryable: true))

    let expired = await AccountDeletion.run(graph: graph(DeletionTransport { HTTPResponse(status: 401, body: Data("{}".utf8)) }))
    #expect(expired == .failed(message: AccountDeletion.expiredMessage, retryable: false))
}

/// Android reaches this through `RuntimeCall` op `deleteAccount`. Uses a graph, not the global
/// test transport, so it cannot race other runtime tests.
@Test func deleteAccountRuntimeOpForAndroid() async throws {
    let ok = try await RuntimeCall.deleteAccount(graph: graph(DeletionTransport { HTTPResponse(status: 200, body: deletedBody) }))
    #expect(ok["deleted"] as? Bool == true)
    #expect(ok["identityProvider"] as? String == "deleted")

    let failed = try await RuntimeCall.deleteAccount(graph: graph(DeletionTransport { HTTPResponse(status: 502, body: Data("{}".utf8)) }))
    #expect(failed["deleted"] as? Bool == false)
    #expect(failed["message"] as? String == AccountDeletion.identityFailedMessage)
    #expect(failed["retryable"] as? Bool == true)

    await #expect(throws: ClientHTTPError.self) {
        _ = try await RuntimeCall.deleteAccount(graph: graph(DeletionTransport { HTTPResponse(status: 401, body: Data("{}".utf8)) }))
    }

    let missingBase = try await call(["op": "deleteAccount", "token": "jwt"])
    #expect(missingBase["ok"] as? Bool == false)
    #expect(missingBase["message"] as? String == "baseURL is required.")
}

@Test func accountDeletionCopyRuntimeOpGivesAndroidTheSharedStrings() async throws {
    let response = try await call(["op": "accountDeletionCopy"])
    #expect(response["ok"] as? Bool == true)
    let copy = try #require(response["result"] as? [String: String])
    #expect(copy["confirmTitle"] == AccountDeletion.confirmTitle)
    #expect(copy["confirmBody"] == AccountDeletion.confirmBody)
    #expect(copy["defaultWebURL"] == AccountDeletion.defaultWebURL)
    #expect(copy.count == 8)
}

private func call(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}
