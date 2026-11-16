import Foundation
import Testing
@testable import CrewCueClientCore

private final class ImportTransport: HTTPTransport, @unchecked Sendable {
    let status: Int
    let body: String
    private let lock = NSLock()
    private var bodies: [Data] = []

    init(status: Int, body: String) {
        self.status = status
        self.body = body
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        lock.withLock { bodies.append(request.body ?? Data()) }
        return HTTPResponse(status: status, body: Data(body.utf8))
    }

    func lastBody() -> [String: Any]? {
        let data = lock.withLock { bodies.last }
        return data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}

private struct NoNetwork: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw URLError(.notConnectedToInternet)
    }
}

private let storedRow = #"{"id":"h1","source":"fit_upload","externalId":"x","recordedAt":"2026-05-10T15:30:00.000Z","ingestedAt":"2026-11-09T00:00:00.000Z","distanceMeters":7991,"elapsedSeconds":2400}"#

private func graph(_ transport: any HTTPTransport) -> ClientGraph {
    ClientGraph(transport: transport, clock: SystemClock(), logger: SilentLogger(), baseURL: URL(string: "https://example.invalid"))
}

@Test func importActivityFileSendsBase64AndReadsStatus() async throws {
    let transport = ImportTransport(status: 201, body: storedRow)
    let bytes = Data([0x0e, 0x20, 0x54, 0x08])
    let saved = try await RaceDayAPI.importActivityFile(graph: graph(transport), fileName: "run.fit", data: bytes)
    #expect(saved.status == .saved)
    #expect(saved.item.summary == "FIT · 8.0 km · 40:00 · 2026-05-10")
    #expect(transport.lastBody()?["contentBase64"] as? String == bytes.base64EncodedString())
    #expect(transport.lastBody()?["fileName"] as? String == "run.fit")

    let duplicate = try await RaceDayAPI.importActivityFile(graph: graph(ImportTransport(status: 200, body: storedRow)), fileName: "run.fit", data: bytes)
    #expect(duplicate.status == .duplicate)
}

@Test func activityImportMessagesAreClear() async {
    #expect(ActivityImport.localProblem(fileName: "a.fit", byteCount: 0) == ActivityImport.emptyMessage)
    #expect(ActivityImport.localProblem(fileName: "a.fit", byteCount: ActivityImport.maxFileBytes + 1) == ActivityImport.tooLargeMessage)
    #expect(ActivityImport.localProblem(fileName: "a.pdf", byteCount: 10) == ActivityImport.errorMessage)
    #expect(ActivityImport.localProblem(fileName: "A.TCX", byteCount: 10) == nil)

    let server = ClientHTTPError(status: 400, message: "x", serverMessage: "Couldn't read this FIT file. Export it again and retry.")
    #expect(ActivityImport.message(for: server) == "Couldn't read this FIT file. Export it again and retry.")
    #expect(ActivityImport.message(for: ClientHTTPError(status: 500, message: "boom")) == ActivityImport.errorMessage)
    #expect(ActivityImport.message(for: URLError(.notConnectedToInternet)) == ActivityImport.offlineMessage)
}

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

@Test func runtimeActivityImportOps() async throws {
    let flags = try #require(try await runtime(["op": "featureFlags"])["result"] as? [String: Any])
    #expect(flags["strava"] as? Bool == false)

    let empty = try #require(try await runtime(["op": "importActivityFile", "fileName": "a.fit", "contentBase64": ""])["result"] as? [String: Any])
    #expect(empty["status"] as? String == "empty")

    let unsupported = try #require(try await runtime([
        "op": "importActivityFile", "fileName": "notes.pdf", "contentBase64": Data("x".utf8).base64EncodedString()
    ])["result"] as? [String: Any])
    #expect(unsupported["status"] as? String == "invalid")

    let missingBase = try await runtime([
        "op": "importActivityFile", "fileName": "a.fit", "contentBase64": Data("x".utf8).base64EncodedString()
    ])
    #expect(missingBase["ok"] as? Bool == false)
}

@Test func activityHistoryItemsSortNewestFirst() async throws {
    let list = #"{"items":[{"id":"a","source":"gpx_upload","recordedAt":"2026-01-01T00:00:00.000Z","distanceMeters":5000},{"id":"b","source":"tcx_upload","recordedAt":"2026-05-01T00:00:00.000Z"}]}"#
    let items = try await RaceDayAPI.activityHistoryItems(graph: graph(ImportTransport(status: 200, body: list)))
    #expect(items.map(\.id) == ["b", "a"])
    #expect(items[0].summary == "TCX · 2026-05-01")
    await #expect(throws: (any Error).self) {
        _ = try await RaceDayAPI.activityHistoryItems(graph: graph(NoNetwork()))
    }
}
