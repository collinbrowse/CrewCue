import Foundation
import Testing
@testable import CrewCueClientCore

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(root["ok"] as? Bool == true, "\(raw)")
    return try #require(root["result"] as? [String: Any])
}

private func failure(_ fields: [String: Any]) async throws -> String {
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(root["ok"] as? Bool == false, "\(raw)")
    return root["message"] as? String ?? ""
}

private func card(_ answer: [String: Any]) -> [String: Any]? { answer["card"] as? [String: Any] }

private var paidRunnerRow: [String: Any] { [
    "id": "r1", "role": "athlete", "entitlementStatus": "paid", "raceStartAt": "2026-08-15T12:00:00.000Z", "hasCourse": true
] }
private var paidCrewRow: [String: Any] { [
    "id": "r2", "role": "crew_member", "entitlementStatus": "paid", "raceStartAt": "2026-08-15T12:00:00.000Z", "hasCourse": true
] }

/// A phone that finished setup: progress saved before the race list loads, so the account isn't
/// taken for an existing one (whose first paid list marks both tours done).
private func setUp(_ user: String, dir: String) async throws {
    _ = try await runtime(["op": "markOnboardingStep", "step": "account", "storageDir": dir, "userId": user])
}

private func storage() -> String {
    FileManager.default.temporaryDirectory
        .appendingPathComponent("tour-rt-\(UUID().uuidString)", isDirectory: true)
        .appendingPathComponent("crewcue-user", isDirectory: true).path
}

@Test func runtimeTourWalksTheRunnerCardsAndSavesEachAnswer() async throws {
    let dir = storage()
    let ada: [String: Any] = ["storageDir": dir, "userId": "ada", "token": "t", "races": [paidRunnerRow], "activeRoomId": "r1", "timeZone": "UTC"]
    try await setUp("ada", dir: dir)
    func op(_ name: String, _ extra: [String: Any] = [:]) async throws -> [String: Any] {
        try await runtime(ada.merging(extra) { $1 }.merging(["op": name]) { $1 })
    }
    let first = try #require(card(try await op("onboardingTour")))
    #expect(first["step"] as? String == "invites")
    #expect(first["anchorIdentifier"] as? String == "crewcue.tab.profile")
    #expect(first["action"] as? String == "shareInvite")
    #expect(first["primaryLabel"] as? String == "Share invite")
    #expect(first["secondaryLabel"] as? String == "Later")
    #expect(first["secondaryOutcome"] as? String == "skipped")
    #expect(first["progressLabel"] as? String == "1 of 5")
    #expect(first["skipLabel"] as? String == "Skip tour")
    #expect(first["accessibilityIdentifier"] as? String == "crewcue.onboarding.tour.invites")

    let notifications = try #require(card(try await op("onboardingTourAnswer", ["step": "invites"])))
    #expect(notifications["step"] as? String == "notifications")
    #expect(notifications["anchor"] is NSNull)
    // A second tap on the card already answered changes nothing.
    #expect(card(try await op("onboardingTourAnswer", ["step": "invites", "outcome": "skipped"]))?["step"] as? String == "notifications")

    let location = try #require(card(try await op("onboardingTourAnswer", ["step": "notifications", "notificationsAllowed": false])))
    #expect(location["step"] as? String == "location")
    #expect(location["secondaryOutcome"] as? String == "deferred")

    // The location test's outcome: running is refused, sent saves done.
    var test = try await runtime(["op": "locationTest", "event": "start", "alreadyTracking": false, "now": "2026-08-01T10:00:00Z"])
    let running = test["test"] as Any
    #expect(try await failure(ada.merging(["op": "onboardingTourAnswer", "step": "location", "locationTest": running]) { $1 })
        .contains("still running"))
    test = try await runtime(["op": "locationTest", "test": running, "event": "pingSent", "now": "2026-08-01T10:00:05Z"])
    let start = try #require(card(try await op("onboardingTourAnswer", ["step": "location", "locationTest": test["test"] as Any])))
    #expect(start["step"] as? String == "mapStartLine")
    #expect(start["action"] as? String == "showStartLine")

    let chat = try #require(card(try await op("onboardingTourAnswer", ["step": "mapStartLine"])))
    #expect(chat["primaryLabel"] as? String == "Done")
    #expect(chat["skipLabel"] is NSNull)
    let done = try await op("onboardingTourAnswer", ["step": "chat"])
    #expect(done["card"] is NSNull)
    #expect((done["state"] as? [String: Any])?["flow"] as? String == "done")
    let tours = try #require((done["progress"] as? [String: Any])?["tours"] as? [String: Any])
    let runner = try #require(tours["runner"] as? [String: Any])
    #expect(runner["invites"] as? String == "done")
    #expect(runner["notifications"] as? String == "skipped")
    #expect(runner["location"] as? String == "done")

    // Then the checklist: invites and location done, notifications off on this phone.
    let checklist = try #require(done["checklist"] as? [String: Any])
    #expect(checklist["summary"] as? String == "2 of 5 done")
    #expect(checklist["next"] as? String == "etaEdits")
    let items = try #require(checklist["items"] as? [[String: Any]])
    #expect(items.map { $0["kind"] as? String } == ["invites", "etaEdits", "checkpointDetails", "notifications", "location"])
    #expect(items[1]["opens"] as? String == "paceStopEdit")
    #expect(items[2]["opens"] as? String == "mapCheckpointPick")
    #expect(items[2]["accessibilityIdentifier"] as? String == "crewcue.setup-checklist.checkpointDetails")

    let opened = try await op("setupChecklistOpen", ["item": "etaEdits", "notificationsOn": true])
    #expect((opened["checklist"] as? [String: Any])?["summary"] as? String == "4 of 5 done")
    let hidden = try await op("setupChecklistHide")
    #expect(hidden["checklist"] is NSNull)
    // A relaunch reads it hidden too.
    #expect(try await op("onboardingTour")["checklist"] is NSNull)
}

@Test func runtimeTourSkipSkipsTheRestAndDefersTheLocationTest() async throws {
    let dir = storage()
    let ada: [String: Any] = ["storageDir": dir, "userId": "ada", "token": "t", "races": [paidRunnerRow], "activeRoomId": "r1"]
    try await setUp("ada", dir: dir)
    _ = try await runtime(ada.merging(["op": "onboardingTourAnswer", "step": "invites", "outcome": "skipped"]) { $1 })
    let skipped = try await runtime(ada.merging(["op": "onboardingTourSkip"]) { $1 })
    #expect(skipped["card"] is NSNull)
    let runner = try #require(((skipped["progress"] as? [String: Any])?["tours"] as? [String: Any])?["runner"] as? [String: Any])
    #expect(runner["location"] as? String == "deferred")
    #expect(runner["chat"] as? String == "skipped")
}

@Test func runtimeCrewTourUsesTheExampleRace() async throws {
    let dir = storage()
    let crew: [String: Any] = ["storageDir": dir, "userId": "cam", "token": "t", "races": [paidCrewRow], "activeRoomId": "r2", "timeZone": "UTC"]
    try await setUp("cam", dir: dir)
    let first = try #require(card(try await runtime(crew.merging(["op": "onboardingTour"]) { $1 })))
    #expect(first["step"] as? String == "runnerLocation")
    #expect(first["progressLabel"] as? String == "1 of 8")
    #expect(first["exampleHeading"] as? String == "Example race")
    let lines = try #require(first["example"] as? [[String: Any]])
    #expect(lines.first?["value"] as? String == "Ada · Mile 13.0")
    // The crew never get the setup checklist.
    let skipped = try await runtime(crew.merging(["op": "onboardingTourSkip"]) { $1 })
    #expect(skipped["checklist"] is NSNull)
    #expect(((skipped["progress"] as? [String: Any])?["tours"] as? [String: Any])?["crew"] != nil)
}

@Test func runtimeDevTourPlaysOnTheExampleRaceAndSavesNothing() async throws {
    let dir = storage()
    var dev: [String: Any] = ["role": "runner", "answers": [String: Any]()]
    var answer = try await runtime(["op": "onboardingTour", "storageDir": dir, "dev": dev])
    #expect(card(answer)?["step"] as? String == "invites")
    for step in ["invites", "notifications", "location", "mapStartLine"] {
        answer = try await runtime(["op": "onboardingTourAnswer", "storageDir": dir, "dev": dev, "step": step,
                                    "outcome": step == "location" ? "deferred" : "done"])
        dev = try #require(answer["dev"] as? [String: Any])
    }
    #expect(card(answer)?["step"] as? String == "chat")
    #expect((dev["answers"] as? [String: Any])?["location"] as? String == "deferred")
    answer = try await runtime(["op": "onboardingTourAnswer", "storageDir": dir, "dev": dev, "step": "chat"])
    dev = try #require(answer["dev"] as? [String: Any])
    let checklist = try #require(answer["checklist"] as? [String: Any])
    #expect(checklist["next"] as? String == "etaEdits")
    answer = try await runtime(["op": "setupChecklistOpen", "storageDir": dir, "dev": dev, "item": "checkpointDetails"])
    #expect((answer["checklist"] as? [String: Any])?["summary"] as? String == "2 of 5 done")
    // Nothing reached the store.
    #expect(!FileManager.default.fileExists(atPath: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: dir)).path))

    let crew = try await runtime(["op": "onboardingTourSkip", "storageDir": dir, "dev": ["role": "crew", "answers": [String: Any]()]])
    #expect(crew["card"] is NSNull)
    #expect(try await failure(["op": "onboardingTour", "storageDir": dir, "dev": ["role": "pacer"]]).contains("role"))
}

@Test func runtimeLocationTestFollowsTheStateMachine() async throws {
    func step(_ test: Any?, _ event: String, _ extra: [String: Any] = [:]) async throws -> [String: Any] {
        var fields: [String: Any] = ["op": "locationTest", "event": event]
        if let test { fields["test"] = test }
        return try await runtime(fields.merging(extra) { $1 })
    }
    let idle = try await step(nil, "read")
    #expect(idle["phase"] as? String == "idle")
    #expect(idle["primaryLabel"] as? String == "Test tracking now")
    #expect(idle["outcome"] as? String == "deferred")

    var answer = try await step(nil, "start", ["alreadyTracking": false, "now": "2026-08-01T10:00:00Z"])
    #expect(answer["phase"] as? String == "asking")
    #expect(answer["isRunning"] as? Bool == true)
    #expect(answer["primaryLabel"] is NSNull)
    #expect(answer["message"] as? String == LocationTestCopy.asking)
    answer = try await step(answer["test"], "permission", ["permission": "whenInUse"])
    #expect(answer["message"] as? String == LocationTestCopy.waitingWhenInUse)
    answer = try await step(answer["test"], "pingSent", ["now": "2026-08-01T10:00:10Z"])
    #expect(answer["phase"] as? String == "sent")
    #expect(answer["outcome"] as? String == "done")
    #expect(answer["stopsTracking"] as? Bool == true)
    #expect((answer["test"] as? [String: Any])?["sentAt"] as? String != nil)
    // With When In Use only, tracking stays on for the Always prompt, then stops.
    #expect(try await step(answer["test"], "read", ["now": "2026-08-01T10:00:20Z"])["waitsForAlways"] as? Bool == true)
    #expect(try await step(answer["test"], "read", ["now": "2026-08-01T10:00:31Z"])["waitsForAlways"] as? Bool == false)
    let always = try await step(answer["test"], "permission", ["permission": "always"])
    #expect(always["message"] as? String == LocationTestCopy.sent)

    // Timeout, denial and offline wait for race morning, with Try again.
    let started = try await step(nil, "start", ["now": "2026-08-01T10:00:00Z"])
    let late = try await step(started["test"], "tick", ["now": "2026-08-01T10:00:46Z"])
    #expect(late["phase"] as? String == "failed")
    #expect(late["primaryLabel"] as? String == "Try again")
    #expect(try await step(started["test"], "permission", ["permission": "denied"])["message"] as? String == LocationTestCopy.denied)
    #expect(try await step(started["test"], "pingQueuedOffline")["message"] as? String == LocationTestCopy.offline)
    // Race-day tracking already on: the test leaves it on.
    let tracking = try await step(nil, "start", ["alreadyTracking": true])
    let sent = try await step(tracking["test"], "pingSent")
    #expect(sent["stopsTracking"] as? Bool == false)
    #expect(sent["message"] as? String == LocationTestCopy.sentStillTracking)
    #expect(try await failure(["op": "locationTest", "event": "jump"]).contains("jump"))
}

@Test func runtimeTourCopyAndNotificationsOutcome() async throws {
    #expect(try await runtime(["op": "tourNotificationsOutcome", "allowed": true])["outcome"] as? String == "done")
    #expect(try await runtime(["op": "tourNotificationsOutcome", "allowed": false])["outcome"] as? String == "skipped")
    let copy = try await runtime(["op": "onboardingTourCopy"])
    #expect((copy["tour"] as? [String: Any])?["skipTour"] as? String == "Skip tour")
    #expect((copy["tour"] as? [String: Any])?["notificationsOff"] as? String == OnboardingTourCopy.notificationsOffAndroid)
    #expect((copy["locationTest"] as? [String: Any])?["sent"] as? String == LocationTestCopy.sent)
    #expect((copy["checklist"] as? [String: Any])?["title"] as? String == "Race setup")
}
