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
