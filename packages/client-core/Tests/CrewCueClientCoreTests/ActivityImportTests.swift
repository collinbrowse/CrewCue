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

@Test func importedRunLabelsForTheRunsSheet() {
    let item = ActivityHistoryItem(id: "a", source: "gpx_upload", recordedAt: "2026-05-10T12:00:00.000Z", distanceMeters: 16_093.44, elapsedSeconds: 6000)
    #expect(item.dateLabel == "May 10, 2026")
    #expect(item.sourceLabel == "GPX")
    #expect(item.distanceLabel == "10.0 mi")
    #expect(item.durationLabel == ScheduleFormat.formatDurationSeconds(6000))
    #expect(item.paceLabel == "10'00\" / mi")
    let bare = ActivityHistoryItem(id: "b", source: "fit_upload", recordedAt: "bad")
    #expect(bare.dateLabel == "bad")
    #expect(bare.distanceLabel == nil)
    #expect(bare.paceLabel == nil)
    #expect(ActivityImport.countLabel(0) == "No runs imported yet")
    #expect(ActivityImport.countLabel(1) == "1 run imported")
    #expect(ActivityImport.countLabel(12) == "12 runs imported")
}

@Test func importedRunTitleIsTheActivityNameElseTheDate() async throws {
    let list = #"{"items":[{"id":"a","source":"gpx_upload","recordedAt":"2026-05-10T12:00:00.000Z","name":"Morning Run"},{"id":"b","source":"fit_upload","recordedAt":"2026-05-11T12:00:00.000Z"},{"id":"c","source":"tcx_upload","recordedAt":"2026-05-09T12:00:00.000Z","name":"   "}]}"#
    let items = try await RaceDayAPI.activityHistoryItems(graph: graph(ImportTransport(status: 200, body: list)))
    let named = try #require(items.first { $0.id == "a" })
    #expect(named.name == "Morning Run")
    #expect(named.titleLabel == "Morning Run")
    #expect(named.subtitleDateLabel == "May 10, 2026")
    let unnamed = try #require(items.first { $0.id == "b" })
    #expect(unnamed.name == nil)
    #expect(unnamed.titleLabel == "May 11, 2026")
    #expect(unnamed.subtitleDateLabel == nil)
    let blank = try #require(items.first { $0.id == "c" })
    #expect(blank.name == nil)
    #expect(blank.titleLabel == "May 9, 2026")

    let namedRow = #"{"id":"h2","source":"gpx_upload","externalId":"x","recordedAt":"2026-05-10T15:30:00.000Z","ingestedAt":"2026-11-09T00:00:00.000Z","name":"Hill repeats"}"#
    let saved = try await RaceDayAPI.importActivityFile(graph: graph(ImportTransport(status: 201, body: namedRow)), fileName: "a.gpx", data: Data([1]))
    #expect(saved.item.titleLabel == "Hill repeats")
}

@Test func runtimeActivityItemCarriesNameAndTitle() {
    let named = RuntimeCall.activityItemJSON(ActivityHistoryItem(id: "a", source: "gpx_upload", recordedAt: "2026-05-10T12:00:00.000Z", name: "Morning Run"))
    #expect(named["name"] as? String == "Morning Run")
    #expect(named["titleLabel"] as? String == "Morning Run")
    #expect(named["subtitleDateLabel"] as? String == "May 10, 2026")
    let unnamed = RuntimeCall.activityItemJSON(ActivityHistoryItem(id: "b", source: "fit_upload", recordedAt: "2026-05-10T12:00:00.000Z"))
    #expect(unnamed["name"] == nil)
    #expect(unnamed["titleLabel"] as? String == "May 10, 2026")
    #expect(unnamed["subtitleDateLabel"] == nil)
}
