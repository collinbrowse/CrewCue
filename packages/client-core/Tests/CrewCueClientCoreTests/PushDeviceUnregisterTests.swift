import Foundation
import Testing
@testable import CrewCueClientCore

private final class UnregisterTransport: HTTPTransport, @unchecked Sendable {
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

private func graph(_ transport: some HTTPTransport, token: String? = "jwt") -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: SilentLogger(),
        baseURL: URL(string: "https://api.example.test"),
        tokenProvider: StaticTokenProvider(token: token),
        outbox: nil
    )
}

@Test func unregisterPushDeviceSendsAuthorizedDeleteForThisPhone() async throws {
    let transport = UnregisterTransport { HTTPResponse(status: 204, body: Data()) }
    let outcome = await PushDeviceUnregister.run(graph: graph(transport), deviceId: "6F1C-ABCD")
    #expect(outcome == .removed)
    let request = try #require(transport.seen().first)
    #expect(transport.seen().count == 1)
    #expect(request.method == .delete)
    #expect(request.url.path == "/chat/devices/6F1C-ABCD")
    #expect(request.headers["Authorization"] == "Bearer jwt")
}

@Test func unregisterPushDeviceEscapesTheDeviceId() async throws {
    let transport = UnregisterTransport { HTTPResponse(status: 204, body: Data()) }
    _ = await PushDeviceUnregister.run(graph: graph(transport), deviceId: "a/b?c")
    let request = try #require(transport.seen().first)
    #expect(request.url.absoluteString == "https://api.example.test/chat/devices/a%2Fb%3Fc")
}

@Test func unregisterPushDeviceOutcomes() async {
    let gone = UnregisterTransport { HTTPResponse(status: 404, body: Data(#"{"error":"Push device not found"}"#.utf8)) }
    #expect(await PushDeviceUnregister.run(graph: graph(gone), deviceId: "phone") == .removed)

    let offline = UnregisterTransport { throw URLError(.notConnectedToInternet) }
    #expect(await PushDeviceUnregister.run(graph: graph(offline), deviceId: "phone") == .failed(offline: true))

    for status in [401, 500] {
        let failing = UnregisterTransport { HTTPResponse(status: status, body: Data(#"{"error":"no"}"#.utf8)) }
        #expect(await PushDeviceUnregister.run(graph: graph(failing), deviceId: "phone") == .failed(offline: false))
    }

    // No session or no device id: nothing is sent.
    let untouched = UnregisterTransport { HTTPResponse(status: 204, body: Data()) }
    #expect(await PushDeviceUnregister.run(graph: graph(untouched, token: nil), deviceId: "phone") == .failed(offline: false))
    #expect(await PushDeviceUnregister.run(graph: graph(untouched), deviceId: "  ") == .failed(offline: false))
    #expect(untouched.seen().isEmpty)
}

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

@Test func runtimeUnregisterPushDeviceLeavesTheSignedOutUsersStorageAlone() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("push-unregister-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let unreachable = try #require(try await runtime([
        "op": "unregisterPushDevice",
        "deviceId": "phone",
        "baseURL": "http://127.0.0.1:1",
        "token": "jwt",
        "userId": "signed-out-user",
        "storageDir": root.path
    ])["result"] as? [String: Any])
    #expect(unreachable["removed"] as? Bool == false)
    #expect(unreachable["offline"] as? Bool == true)
    // Sign-out already wiped this user's files: the op must not open an outbox and recreate them.
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
}
