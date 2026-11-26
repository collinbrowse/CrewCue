import Foundation
import Testing
@testable import CrewCueClientCore

private final class RaceDeleteTransport: HTTPTransport, @unchecked Sendable {
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

@Test func deleteRaceSendsAuthorizedDeleteForTheRoom() async throws {
    let transport = RaceDeleteTransport { HTTPResponse(status: 200, body: Data(#"{"deleted":true}"#.utf8)) }
    try await RaceDayAPI.deleteRace(graph: graph(transport), roomId: "room-1")
    let request = try #require(transport.seen().first)
    #expect(transport.seen().count == 1)
    #expect(request.method == .delete)
    #expect(request.url.path == "/race-rooms/room-1")
    #expect(request.headers["Authorization"] == "Bearer jwt")
}

@Test func deleteRaceRefusedOrFailedThrows() async {
    for status in [403, 404, 500] {
        let transport = RaceDeleteTransport { HTTPResponse(status: status, body: Data(#"{"error":"no"}"#.utf8)) }
        await #expect(throws: ClientHTTPError.self) {
            try await RaceDayAPI.deleteRace(graph: graph(transport), roomId: "room-1")
        }
    }
    let offline = RaceDeleteTransport { throw URLError(.notConnectedToInternet) }
    do {
        try await RaceDayAPI.deleteRace(graph: graph(offline), roomId: "room-1")
        Issue.record("an offline delete must throw")
    } catch {
        #expect(TransportFailure.isOffline(error))
    }
}

@Test func raceDeletionOutcomesSayWhatHappened() async {
    func run(_ respond: @escaping @Sendable () throws -> HTTPResponse) async -> RaceDeletion.Outcome {
        await RaceDeletion.run(graph: graph(RaceDeleteTransport(respond)), roomId: "room-1")
    }
    #expect(await run { HTTPResponse(status: 200, body: Data(#"{"deleted":true}"#.utf8)) } == .deleted)
    // Already gone (another device deleted it) is what the owner asked for.
    #expect(await run { HTTPResponse(status: 404, body: Data("{}".utf8)) } == .deleted)
    #expect(await run { HTTPResponse(status: 403, body: Data("{}".utf8)) } == .failed(message: RaceDeletion.notOwnerMessage))
    #expect(await run { HTTPResponse(status: 500, body: Data("{}".utf8)) } == .failed(message: RaceDeletion.genericFailureMessage))
    #expect(await run { throw URLError(.notConnectedToInternet) } == .failed(message: RaceDeletion.offlineMessage))
}

@Test func raceDeletionCopyWarnsItCannotBeUndone() {
    #expect(RaceDeletion.confirmTitle(raceName: " Leadville ") == "Delete Leadville?")
    #expect(RaceDeletion.confirmTitle(raceName: "") == "Delete this race?")
    for paid in [true, false] {
        let body = RaceDeletion.confirmBody(paid: paid)
        #expect(body.contains("whole crew"))
        #expect(body.contains("can't be undone"))
        #expect(body.contains("Rename the race"))
        #expect(body.contains("Race Pass") == paid)
    }
}

/// Android reaches the delete through `RuntimeCall` op `deleteRace`. Uses a graph, not the global
/// test transport, so it cannot race other runtime tests.
@Test func deleteRaceRuntimeOpForAndroid() async throws {
    let transport = RaceDeleteTransport { HTTPResponse(status: 200, body: Data(#"{"deleted":true}"#.utf8)) }
    let ok = try await RuntimeCall.deleteRace(graph: graph(transport), roomId: "room-1")
    #expect(ok["deleted"] as? Bool == true)
    #expect(ok["message"] as? String == RaceDeletion.deletedMessage)
    #expect(transport.seen().first?.url.path == "/race-rooms/room-1")
    #expect(transport.seen().first?.method == .delete)

    func run(_ respond: @escaping @Sendable () throws -> HTTPResponse) async throws -> [String: Any] {
        try await RuntimeCall.deleteRace(graph: graph(RaceDeleteTransport(respond)), roomId: "room-1")
    }
    let gone = try await run { HTTPResponse(status: 404, body: Data("{}".utf8)) }
    #expect(gone["deleted"] as? Bool == true)
    let notOwner = try await run { HTTPResponse(status: 403, body: Data("{}".utf8)) }
    #expect(notOwner["deleted"] as? Bool == false)
    #expect(notOwner["message"] as? String == RaceDeletion.notOwnerMessage)
    let server = try await run { HTTPResponse(status: 500, body: Data("{}".utf8)) }
    #expect(server["message"] as? String == RaceDeletion.genericFailureMessage)
    let offline = try await run { throw URLError(.notConnectedToInternet) }
    #expect(offline["deleted"] as? Bool == false)
    #expect(offline["message"] as? String == RaceDeletion.offlineMessage)

    // An expired session still throws, so the app signs out as for every other op.
    await #expect(throws: ClientHTTPError.self) {
        _ = try await run { HTTPResponse(status: 401, body: Data("{}".utf8)) }
    }
    let unsent = RaceDeleteTransport { HTTPResponse(status: 200, body: Data("{}".utf8)) }
    await #expect(throws: ClientHTTPError.self) {
        _ = try await RuntimeCall.deleteRace(graph: graph(unsent), roomId: "")
    }
    #expect(unsent.seen().isEmpty)
}

@Test func raceDeletionCopyRuntimeOpGivesAndroidTheSharedStrings() async throws {
    let data = try JSONSerialization.data(withJSONObject: ["op": "raceDeletionCopy", "raceName": "Leadville", "paid": true])
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    let response = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(response["ok"] as? Bool == true)
    let copy = try #require(response["result"] as? [String: String])
    #expect(copy["rowTitle"] == RaceDeletion.rowTitle)
    #expect(copy["rowDetail"] == RaceDeletion.rowDetail)
    #expect(copy["confirmTitle"] == "Delete Leadville?")
    #expect(copy["confirmBody"] == RaceDeletion.confirmBody(paid: true))
    #expect(copy["confirmButton"] == RaceDeletion.confirmButton)
    #expect(copy["cancelButton"] == RaceDeletion.cancelButton)
    #expect(copy["offlineMessage"] == RaceDeletion.offlineMessage)

    let unpaid = RuntimeCall.raceDeletionCopy(raceName: "", paid: false)
    #expect(unpaid["confirmTitle"] == "Delete this race?")
    #expect(unpaid["confirmBody"] == RaceDeletion.confirmBody(paid: false))
    #expect(unpaid["confirmBody"]?.contains("Race Pass") == false)
}
