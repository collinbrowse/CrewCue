import Foundation
import Testing
@testable import CrewCueClientCore

private struct FixedTransport: HTTPTransport {
    let status: Int
    let body: String
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        HTTPResponse(status: status, body: Data(body.utf8))
    }
}

/// The job flow: the upload answers 202 `{jobId}`, the job polls 202 twice, then the result.
private actor JobServer: HTTPTransport {
    let result: (status: Int, body: String)
    private(set) var requests: [String] = []
    private var polls = 0
    init(result: (status: Int, body: String)) { self.result = result }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append("\(request.method.rawValue) \(request.url.path)")
        if request.url.path.hasSuffix("/activity-history/upload") {
            return HTTPResponse(status: 202, body: Data(#"{"jobId":"job-1"}"#.utf8))
        }
        polls += 1
        if polls < 3 { return HTTPResponse(status: 202, body: Data(#"{"state":"running"}"#.utf8)) }
        return HTTPResponse(status: result.status, body: Data(result.body.utf8))
    }
}

private let fastPoll = RaceDayAPI.UploadPoll(intervalSeconds: 0.001, maxWaitSeconds: 5)

@Test func uploadWaitsOnTheBackgroundJob() async throws {
    let server = JobServer(result: (200, previewBody))
    let preview = try await RaceDayAPI.previewActivityUpload(graph: graph(server), fileName: "export.zip", data: Data([1]), poll: fastPoll)
    #expect(preview.runs.count == 2)
    #expect(await server.requests == [
        "POST /activity-history/upload",
        "GET /activity-history/upload-jobs/job-1",
        "GET /activity-history/upload-jobs/job-1",
        "GET /activity-history/upload-jobs/job-1"
    ])
    let saved = JobServer(result: (201, #"{"saved":174,"duplicates":0,"unreadable":[],"items":[]}"#))
    let done = try await RaceDayAPI.importActivityUpload(graph: graph(saved), fileName: "export.zip", data: Data([1]), poll: fastPoll)
    #expect(done.message == "174 runs imported.")
}

@Test func uploadJobFailuresAreClear() async {
    let corrupt = JobServer(result: (400, #"{"error":"Couldn't read this .zip file.","code":"file_corrupt"}"#))
    await #expect(throws: ClientHTTPError.self) {
        _ = try await RaceDayAPI.previewActivityUpload(graph: graph(corrupt), fileName: "x.zip", data: Data([1]), poll: fastPoll)
    }
    let lost = JobServer(result: (404, #"{"error":"Upload not found. Share the file again.","code":"upload_not_found"}"#))
    do {
        _ = try await RaceDayAPI.previewActivityUpload(graph: graph(lost), fileName: "x.zip", data: Data([1]), poll: fastPoll)
        Issue.record("expected a failure")
    } catch {
        #expect(SharedRunImport.message(for: error) == SharedRunImport.uploadLostMessage)
    }
    let slow = JobServer(result: (202, #"{"state":"running"}"#))
    do {
        _ = try await RaceDayAPI.previewActivityUpload(
            graph: graph(slow), fileName: "x.zip", data: Data([1]),
            poll: RaceDayAPI.UploadPoll(intervalSeconds: 0.001, maxWaitSeconds: 0.01))
        Issue.record("expected a timeout")
    } catch {
        #expect(SharedRunImport.message(for: error) == SharedRunImport.uploadTimeoutMessage)
    }
}

private struct NoNetwork: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw URLError(.notConnectedToInternet)
    }
}

private func graph(_ transport: any HTTPTransport) -> ClientGraph {
    ClientGraph(transport: transport, clock: SystemClock(), logger: SilentLogger(), baseURL: URL(string: "https://example.invalid"))
}

private let previewBody = #"""
{"runs":[
 {"fileName":"hill.fit","source":"fit_upload","recordedAt":"2026-11-19T13:07:38.000Z","distanceMeters":14600,"elapsedSeconds":6192,"elevationGainMeters":604,"track":[[37.28,-107.87],[37.29,-107.88]],"alreadyImported":false},
 {"fileName":"road.gpx","source":"gpx_upload","recordedAt":"2026-05-10T15:30:00.000Z","distanceMeters":7991,"track":[],"alreadyImported":true}
],"unreadable":[{"fileName":"README.txt","error":"Not a .gpx, .fit or .tcx file."}]}
"""#

@Test func sharedFileStartsSignedOutOrWithALocalProblem() {
    #expect(SharedRunImport.start(signedIn: false, fileName: "run.fit", byteCount: 10) == .signedOut)
    #expect(SharedRunImport.start(signedIn: true, fileName: "run.fit", byteCount: 0) == .failed(ActivityImport.emptyMessage))
    #expect(SharedRunImport.start(signedIn: true, fileName: "big.zip", byteCount: SharedRunImport.maxUploadBytes + 1) == .failed(SharedRunImport.tooLargeMessage))
    #expect(SharedRunImport.start(signedIn: true, fileName: "notes.pdf", byteCount: 10) == .failed(SharedRunImport.unreadableMessage))
    #expect(SharedRunImport.start(signedIn: true, fileName: "Export.ZIP", byteCount: 10) == .reading(fileName: "Export.ZIP"))
    #expect(SharedRunImport.signedOutMessage == "Sign in to import runs.")
}

@Test func previewDecodesAndWordsTheConfirm() async throws {
    let preview = try await RaceDayAPI.previewActivityUpload(graph: graph(FixedTransport(status: 200, body: previewBody)), fileName: "export.zip", data: Data([1]))
    #expect(preview.runs.count == 2)
    #expect(preview.newRuns.map(\.fileName) == ["hill.fit"])
    #expect(preview.title == "Import this run?")
    #expect(preview.confirmLabel == "Import")
    #expect(preview.unreadableLine == "1 file can't be read")
    #expect(preview.runs[0].dateLabel == "Thu, Nov 19, 2026")
    #expect(preview.runs[0].details == [
        ActivityRunDetail(label: "Distance", value: "14.6 km"),
        ActivityRunDetail(label: "Time", value: "1:43:12"),
        ActivityRunDetail(label: "Climb", value: "604 m")
    ])
    #expect(preview.runs[0].spokenSummary == "Thu, Nov 19, 2026. Distance 14.6 km. Time 1:43:12. Climb 604 m.")
    #expect(preview.runs[1].dateLabel == "Sun, May 10, 2026")
    #expect(preview.runs[1].details.map(\.value) == ["8.0 km", "–", "–"])
    #expect(preview.runs[1].spokenSummary == "Sun, May 10, 2026. Distance 8.0 km. Already imported.")
    #expect(SharedRunImport.afterPreview(.success(preview)) == .preview(preview))

    let many = ActivityUploadPreview(runs: (0..<41).map { ActivityPreviewRun(fileName: "\($0).fit", source: "fit_upload", recordedAt: "2026-01-01", distanceMeters: 1000) })
    #expect(many.title == "Import 41 runs?")
    #expect(many.confirmLabel == "Import 41 runs")
    let old = ActivityUploadPreview(runs: [ActivityPreviewRun(fileName: "a.fit", source: "fit_upload", recordedAt: "2026-01-01", distanceMeters: 1000, alreadyImported: true)])
    #expect(old.title == ActivityImport.duplicateMessage)
    #expect(old.canImport == false)
}

@Test func previewAndImportFailuresAreClear() async {
    #expect(SharedRunImport.afterPreview(.success(ActivityUploadPreview(runs: []))) == .failed(SharedRunImport.unreadableMessage))
    let server = ClientHTTPError(status: 400, message: "x", serverMessage: "Couldn't read this .zip file.")
    #expect(SharedRunImport.afterPreview(.failure(server)) == .failed("Couldn't read this .zip file."))
    #expect(SharedRunImport.afterImport(.failure(ClientHTTPError(status: 500, message: "boom"))) == .failed(SharedRunImport.unreadableMessage))
    #expect(SharedRunImport.afterPreview(.failure(ClientHTTPError(status: 401, message: "no"))) == .failed(SharedRunImport.signedOutMessage))
    do {
        _ = try await RaceDayAPI.previewActivityUpload(graph: graph(NoNetwork()), fileName: "run.fit", data: Data([1]))
        Issue.record("expected offline")
    } catch {
        #expect(SharedRunImport.message(for: error) == ActivityImport.offlineMessage)
    }
}

@Test func importResultMessages() async throws {
    let result = try await RaceDayAPI.importActivityUpload(
        graph: graph(FixedTransport(status: 201, body: #"{"saved":41,"duplicates":2,"unreadable":[],"items":[]}"#)),
        fileName: "export.zip",
        data: Data([1])
    )
    #expect(result.message == "41 runs imported.")
    #expect(ActivityUploadResult(saved: 1, duplicates: 0).message == "Run imported.")
    #expect(ActivityUploadResult(saved: 0, duplicates: 3).message == ActivityImport.duplicateMessage)
    #expect(SharedRunImport.afterImport(.success(result)) == .done("41 runs imported."))
}

@Test func bulkPreviewSummarizesWhatWasSkipped() throws {
    let body = #"""
    {"runs":[],"unreadable":[{"fileName":"a.fit","error":"x"}],"skipped":{"older":847,"notRun":344,"unreadable":714}}
    """#
    var preview = try JSONDecoder().decode(ActivityUploadPreview.self, from: Data(body.utf8))
    preview.runs = (0..<180).map { ActivityPreviewRun(fileName: "\($0).fit", source: "fit_upload", recordedAt: "2026-01-01", distanceMeters: 5000) }
    #expect(preview.title == "Import 180 runs?")
    #expect(preview.skippedLine == "1,905 files skipped: 847 older than a year, 344 not runs or hikes, 714 unreadable")
    #expect(preview.unreadableLine == nil)
    #expect(preview.listedRuns(showingAll: false).count == 10)
    #expect(preview.showMoreLabel(showingAll: false) == "Show 170 more")
    #expect(preview.listedRuns(showingAll: true).count == 180)
    #expect(preview.showMoreLabel(showingAll: true) == nil)
    let few = ActivityUploadPreview(runs: Array(preview.runs.prefix(10)))
    #expect(few.showMoreLabel(showingAll: false) == nil)
    #expect(SharedRunImport.count(1_234_567) == "1,234,567")
    #expect(SharedRunImport.count(999) == "999")
    #expect(SharedRunImport.start(signedIn: true, fileName: "export.zip", byteCount: 128 * 1024 * 1024) == .reading(fileName: "export.zip"))
}
