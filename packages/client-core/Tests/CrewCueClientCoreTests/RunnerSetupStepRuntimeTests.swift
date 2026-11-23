import Foundation
import Testing
@testable import CrewCueClientCore

// Android's `runnerSetupStep` and `updateRaceStart` ops: the same `RunnerSetupSteps` rules iOS
// follows, read through the runtime (clients/behavior/onboarding-runner-setup.md).

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func result(_ root: [String: Any]) throws -> [String: Any] {
    #expect(root["ok"] as? Bool == true, "\(root)")
    return try #require(root["result"] as? [String: Any], "\(root)")
}

private func decide(_ decision: String, _ fields: [String: Any] = [:]) async throws -> [String: Any] {
    try result(try await runtime(["op": "runnerSetupStep", "decision": decision].merging(fields) { $1 }))
}

/// Answers each request path with a fixed status and body, and records what it was sent.
private final class StartServer: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let answers: [String: (Int, String)]
    private var requests: [(method: String, path: String, body: [String: Any])] = []

    init(_ answers: [String: (Int, String)]) {
        self.answers = answers
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let body = request.body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        return lock.withLock {
            requests.append((request.method.rawValue, request.url.path, body))
            let key = "\(request.method.rawValue) \(request.url.path)"
            guard let answer = answers[key] else {
                return HTTPResponse(status: 500, body: Data(#"{"error":"unscripted \#(key)"}"#.utf8))
            }
            return HTTPResponse(status: answer.0, body: Data(answer.1.utf8))
        }
    }

    var sent: [(method: String, path: String, body: [String: Any])] { lock.withLock { requests } }
}

private struct OfflineServer: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw URLError(.notConnectedToInternet)
    }
}

// MARK: Steps

@Test func navigationShowsTheReviewedStepAndWhereBackGoes() async throws {
    let reviewed = try await decide("navigation", ["frontier": "history", "reviewing": "course", "raceExists": true])
    #expect(reviewed["shown"] as? String == "course")
    #expect(reviewed["reviewing"] as? String == "course")
    #expect(reviewed["previous"] as? String == "account")
    #expect(reviewed["canGoBack"] as? Bool == true)

    let frontier = try await decide("navigation", ["frontier": "startTime", "raceExists": true])
    #expect(frontier["shown"] as? String == "startTime")
    #expect(frontier["reviewing"] is NSNull)
    #expect(frontier["previous"] as? String == "course")

    // A reviewed step that isn't behind the frontier any more is the frontier itself.
    let caughtUp = try await decide("navigation", ["frontier": "course", "reviewing": "history", "raceExists": true])
    #expect(caughtUp["shown"] as? String == "course")
    #expect(caughtUp["reviewing"] is NSNull)

    // The first step: Back returns to the chooser only while no race exists.
    let first = try await decide("navigation", ["frontier": "account", "raceExists": false])
    #expect(first["previous"] is NSNull)
    #expect(first["canGoBack"] as? Bool == true)
    let raced = try await decide("navigation", ["frontier": "history", "reviewing": "account", "raceExists": true])
    #expect(raced["shown"] as? String == "account")
    #expect(raced["canGoBack"] as? Bool == false)
}

@Test func moveOnWalksAReviewedStepForwardAndNeverMovesTheFrontierBack() async throws {
    let walk = try await decide("moveOn", ["frontier": "projectionTeaser", "reviewing": "course", "next": "startTime"])
    #expect(walk["frontier"] as? String == "projectionTeaser")
    #expect(walk["reviewing"] as? String == "startTime")
    let met = try await decide("moveOn", ["frontier": "history", "reviewing": "startTime", "next": "history"])
    #expect(met["frontier"] as? String == "history")
    #expect(met["reviewing"] is NSNull)
    // On the frontier: the frontier moves forward and nothing is reviewed.
    let ahead = try await decide("moveOn", ["frontier": "course", "next": "startTime"])
    #expect(ahead["frontier"] as? String == "startTime")
    #expect(ahead["reviewing"] is NSNull)
    // A save behind the frontier (the course again, from the teaser) keeps the teaser as the frontier.
    let behind = try await decide("moveOn", ["frontier": "projectionTeaser", "next": "history"])
    #expect(behind["frontier"] as? String == "projectionTeaser")
}

@Test func aStepDecisionWithoutItsStepOrAnUnknownDecisionFails() async throws {
    let missing = try await runtime(["op": "runnerSetupStep", "decision": "navigation"])
    #expect(missing["ok"] as? Bool == false)
    #expect(missing["status"] as? Int == 400)
    let unknownStep = try await runtime(["op": "runnerSetupStep", "decision": "moveOn", "frontier": "course", "next": "dance"])
    #expect(unknownStep["status"] as? Int == 400)
    let unknown = try await runtime(["op": "runnerSetupStep", "decision": "jump"])
    #expect(unknown["status"] as? Int == 400)
}

@Test func theRaceNameOpNamesAsTypedElseAsListedNeverAfterTheFile() async throws {
    #expect(try await decide("newRaceName", ["typed": "  Canyons 2027 ", "listed": "Western States"])["name"] as? String == "Canyons 2027")
    #expect(try await decide("newRaceName", ["typed": "", "listed": " Western States "])["name"] as? String == "Western States")
    #expect(try await decide("newRaceName", ["typed": "   "])["name"] is NSNull)
}

@Test func theCourseOpsCompareFilesByContentAndPickTheMainButton() async throws {
    let xml = "<gpx><trk/></gpx>"
    let fingerprint = try #require(try await decide("courseFingerprint", ["xml": "\n" + xml + "  "])["fingerprint"] as? String)
    #expect(fingerprint == RunnerSetupSteps.courseFingerprint(xml))
    #expect(try await decide("coursePick", ["fingerprint": fingerprint, "held": fingerprint])["pick"] as? String == "unchanged")
    #expect(try await decide("coursePick", ["fingerprint": fingerprint, "held": "other", "saved": fingerprint])["pick"] as? String == "savedCourse")
    #expect(try await decide("coursePick", ["fingerprint": fingerprint])["pick"] as? String == "newCourse")

    #expect(try await decide("courseContinue", ["holdsPickedFile": true, "previewed": true])["action"] as? String == "confirm")
    #expect(try await decide("courseContinue", ["holdsPickedFile": true, "previewed": false])["action"] as? String == "preview")
    #expect(try await decide("courseContinue", ["courseSavedOnRace": true])["action"] as? String == "keepSavedCourse")
    #expect(try await decide("courseContinue")["action"] as? String == "chooseFile")
}

@Test func theStartTimeOpsSaveOnlyWhatChanged() async throws {
    let saved = "2026-08-15T12:30:00.000Z"
    let moved = "2026-08-15T13:00:00.000Z"
    func continueStart(_ fields: [String: Any]) async throws -> String? {
        try await decide("startTimeContinue", fields)["action"] as? String
    }
    // Reviewed and left as the race saved it: on, with no request and no course file.
    #expect(try await continueStart(["reviewing": true, "courseSavedOnRace": true, "start": saved, "savedStart": saved]) == "moveOn")
    // A start-only change on a race with a course: PATCH race-start.
    #expect(try await continueStart([
        "reviewing": true, "editedThisVisit": true, "courseSavedOnRace": true, "start": moved, "savedStart": saved
    ]) == "saveStart")
    // A new file picked: the course goes with the start, or the file is needed again.
    #expect(try await continueStart(["courseUnsaved": true, "holdsCourseFile": true, "start": saved]) == "saveCourse")
    #expect(try await continueStart(["courseUnsaved": true, "start": saved]) == "needsCourseFile")
    #expect(try await continueStart(["courseUnsaved": true, "holdsCourseFile": true]) == "invalidStart")

    #expect(try await decide("startUnsaved", ["draftHasStart": true, "draftStart": moved, "savedStart": saved])["value"] as? Bool == true)
    #expect(try await decide("startUnsaved", ["draftHasStart": true, "draftStart": saved, "savedStart": saved])["value"] as? Bool == false)
    #expect(try await decide("startUnsaved", ["draftHasStart": true, "draftStart": moved])["value"] as? Bool == false)
}

@Test func raceStartAdoptionFillsAPhoneWithoutAStartAndReadsTheServersClock() async throws {
    let start = "2026-08-15T12:30:00.000Z"
    let fill = try await decide("raceStartAdoption", ["raceStart": start])
    #expect(fill["adoption"] as? String == "fill")
    #expect(fill["raceStart"] as? String == start)
    let keep = try await decide("raceStartAdoption", ["draftHasStart": true, "draftStart": start, "savedStart": start, "raceStart": start])
    #expect(keep["adoption"] as? String == "keep")
    // An unsaved edit stays on screen; the race's start becomes the saved one.
    let edited = try await decide("raceStartAdoption", [
        "draftHasStart": true, "draftStart": "2026-08-15T14:00:00.000Z", "raceStart": start, "courseUnsaved": true
    ])
    #expect(edited["adoption"] as? String == "takeSaved")
    // A race with only the legacy activatedAt: the server's clock reads that.
    let legacy = try await decide("raceStartAdoption", ["activatedAt": start])
    #expect(legacy["adoption"] as? String == "fill")
    #expect(legacy["raceStart"] as? String == start)
    let none = try await decide("raceStartAdoption", ["draftHasStart": true, "draftStart": start])
    #expect(none["adoption"] as? String == "keep")
    #expect(none["raceStart"] is NSNull)
}

@Test func theHistoryOpsKeepAReviewedEstimateUnlessACourseSaveDroppedIt() async throws {
    #expect(try await decide("historyShowsContinue", ["reviewing": true])["value"] as? Bool == true)
    #expect(try await decide("historyShowsContinue")["value"] as? Bool == false)
    #expect(try await decide("historyShowsContinue", ["importedThisVisit": true])["value"] as? Bool == true)
    #expect(try await decide("historyContinue", ["reviewing": true])["action"] as? String == "moveOn")
    #expect(try await decide("historyContinue", ["reviewing": true, "estimateDropped": true])["action"] as? String == "recompute")
    #expect(try await decide("historyContinue", ["attachedThisVisit": true, "estimateDropped": true])["action"] as? String == "moveOn")
    #expect(try await decide("historyContinue")["action"] as? String == "recompute")
    // A race that already has an estimate (a phone without this race's setup progress).
    #expect(try await decide("historyShowsContinue", ["raceHasEstimate": true])["value"] as? Bool == true)
    #expect(try await decide("historyContinue", ["raceHasEstimate": true])["action"] as? String == "keepRaceEstimate")
}

@Test func resumeStepReopensTheStepThatStillHasSomethingToSave() async throws {
    #expect(try await decide("resumeStep", ["frontier": "projectionTeaser", "courseUnsaved": true])["step"] as? String == "course")
    #expect(try await decide("resumeStep", ["frontier": "history", "courseUnsaved": true, "coursePreviewed": true])["step"] as? String == "startTime")
    #expect(try await decide("resumeStep", ["frontier": "history", "startUnsaved": true])["step"] as? String == "startTime")
    #expect(try await decide("resumeStep", ["frontier": "projectionTeaser", "estimateDropped": true])["step"] as? String == "history")
    #expect(try await decide("resumeStep", ["frontier": "startTime", "courseUnsaved": true])["step"] is NSNull)
    #expect(try await decide("resumeStep", ["frontier": "projectionTeaser"])["step"] is NSNull)
}

// MARK: updateRaceStart

private let roomBody = #"{"id":"r1","teamId":"t","athleteId":"ada","name":"Canyons 2027","status":"active","createdAt":"2026-11-01T00:00:00.000Z","raceStartAt":"2026-11-21T14:30:00.000Z","memberships":[],"entitlement":{"status":"unpaid","lastUpdatedAt":"2026-11-01T00:00:00.000Z","source":"free"}}"#

@Test func updateRaceStartOpPatchesTheStartAlone() async throws {
    let base = "https://race-start.test"
    let server = StartServer(["PATCH /race-rooms/r1/race-start": (200, roomBody)])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let saved = try result(try await runtime([
        "op": "updateRaceStart", "baseURL": base, "token": "t", "userId": "ada",
        "roomId": "r1", "raceStartAt": "2026-11-21T14:30:00.000Z"
    ]))
    #expect(saved["status"] as? String == "saved")
    #expect(saved["raceStartAt"] as? String == "2026-11-21T14:30:00.000Z")
    // Only the start: no course upload, no preview.
    #expect(server.sent.map { "\($0.method) \($0.path)" } == ["PATCH /race-rooms/r1/race-start"])
    #expect(server.sent.first?.body["raceStartAt"] as? String == "2026-11-21T14:30:00.000Z")
}

@Test func updateRaceStartOpCarriesTheLimitAndOfflineForAndroid() async throws {
    let base = "https://race-start-limit.test"
    let server = StartServer(["PATCH /race-rooms/r1/race-start": (429, #"{"error":"Too many requests"}"#)])
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let limited = try await runtime(["op": "updateRaceStart", "baseURL": base, "roomId": "r1", "raceStartAt": "2026-11-21T14:30:00.000Z"])
    #expect(limited["ok"] as? Bool == false)
    #expect(limited["status"] as? Int == 429)
    #expect(limited["offline"] as? Bool == false)

    let offlineBase = "https://race-start-offline.test"
    RuntimeCall.setTransportForTests(OfflineServer(), baseURL: offlineBase)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: offlineBase) }
    let offline = try await runtime(["op": "updateRaceStart", "baseURL": offlineBase, "roomId": "r1", "raceStartAt": "2026-11-21T14:30:00.000Z"])
    #expect(offline["ok"] as? Bool == false)
    #expect(offline["offline"] as? Bool == true)

    let missing = try await runtime(["op": "updateRaceStart", "baseURL": base, "roomId": "r1"])
    #expect(missing["status"] as? Int == 400)
    #expect(server.sent.count == 1)
}

// MARK: resetOnboarding choiceOnly

@Test func backFromTheFirstSetupStepForgetsOnlyThePick() async throws {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("setup-back-\(UUID().uuidString)", isDirectory: true)
    let storage = base.appendingPathComponent("crewcue-user", isDirectory: true).path
    let ada: [String: Any] = ["storageDir": storage, "userId": "ada", "token": "t", "races": [Any]()]
    _ = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "choice": "runner"]) { $1 }))
    _ = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "step": "account"]) { $1 }))
    let cleared = try result(try await runtime(ada.merging(["op": "resetOnboarding", "choiceOnly": true]) { $1 }))
    let progress = try #require(cleared["progress"] as? [String: Any])
    #expect(progress["choice"] == nil || progress["choice"] is NSNull)
    let read = try #require(try result(try await runtime(ada.merging(["op": "readOnboarding"]) { $1 }))["state"] as? [String: Any])
    #expect(read["flow"] as? String == "chooser")
    // Everything else the user did stays: only the pick is gone.
    let store = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: storage, isDirectory: true)))
    let saved = store.load(userId: "ada")
    #expect(saved.choice == nil)
    #expect(saved.account[.account] == .done)
}
