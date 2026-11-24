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
    #expect(preview.runs[0].summary == "2026-11-19 · 14.6 km · 1:43:12 · 604 m climb")
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
