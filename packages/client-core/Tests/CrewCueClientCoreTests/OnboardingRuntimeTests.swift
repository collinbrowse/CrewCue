import Foundation
import Testing
@testable import CrewCueClientCore

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func result(_ root: [String: Any]) throws -> [String: Any] {
    #expect(root["ok"] as? Bool == true, "\(root["message"] ?? "")")
    return try #require(root["result"] as? [String: Any])
}

private func state(_ root: [String: Any]) throws -> [String: Any] {
    try #require(try result(root)["state"] as? [String: Any])
}

private var unpaidRace: [String: Any] { [
    "id": "r1", "role": "athlete", "entitlementStatus": "unpaid", "raceStartAt": "2026-08-15T12:00:00.000Z", "hasCourse": true
] }

@Test func onboardingRuntimeOpsRoundTrip() async throws {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("onboarding-rt-\(UUID().uuidString)", isDirectory: true)
    let storage = base.appendingPathComponent("crewcue-user", isDirectory: true).path
    let signedOut: [String: Any] = ["storageDir": storage, "userId": "", "token": ""]
    let ada: [String: Any] = ["storageDir": storage, "userId": "ada", "token": "t", "races": [Any]()]

    var read = try state(try await runtime(signedOut.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["flow"] as? String == "chooser")
    #expect(read["step"] is NSNull)

    let chosen = try result(try await runtime(signedOut.merging(["op": "markOnboardingStep", "choice": "runner"]) { $1 }))
    #expect((chosen["progress"] as? [String: Any])?["choice"] as? String == "runner")
    #expect((chosen["state"] as? [String: Any])?["flow"] as? String == "runner")
    read = try state(try await runtime(signedOut.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["flow"] as? String == "runner")
    #expect(read["step"] as? String == "account")
    #expect(read["showsTabBar"] as? Bool == false)

    // Signing in adopts the signed-out pick.
    read = try state(try await runtime(ada.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["flow"] as? String == "runner")
    #expect(read["step"] as? String == "account")
    let onboardingDir = OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: storage, isDirectory: true))
    #expect(try FileManager.default.contentsOfDirectory(atPath: onboardingDir.path) == ["ada.json"])

    var marked = try state(try await runtime(ada.merging(["op": "markOnboardingStep", "step": "account"]) { $1 }))
    #expect(marked["step"] as? String == "course")

    let server = try await runtime(ada.merging(["op": "markOnboardingStep", "step": "course"]) { $1 })
    #expect(server["ok"] as? Bool == false)
    #expect(server["message"] as? String == OnboardingError.followsServer(.course).message)
    let roomless = try await runtime(ada.merging(["op": "markOnboardingStep", "step": "preview", "outcome": "skipped"]) { $1 })
    #expect(roomless["message"] as? String == OnboardingError.roomRequired(.preview).message)
    let unknown = try await runtime(ada.merging(["op": "markOnboardingStep", "step": "dance"]) { $1 })
    #expect(unknown["ok"] as? Bool == false)

    let withRace = ada.merging(["races": [unpaidRace], "activeRoomId": "r1"]) { $1 }
    read = try state(try await runtime(withRace.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["step"] as? String == "history")
    #expect(read["roomId"] as? String == "r1")
    marked = try state(try await runtime(withRace.merging(["op": "markOnboardingStep", "step": "history", "outcome": "skipped"]) { $1 }))
    #expect(marked["step"] as? String == "projectionTeaser")
    let steps = try #require(marked["steps"] as? [[String: Any]])
    let history = try #require(steps.first { $0["step"] as? String == "history" })
    #expect(history["outcome"] as? String == "skipped")
    #expect(history["complete"] as? Bool == true)
    _ = try result(try await runtime(withRace.merging(["op": "markOnboardingStep", "step": "location", "outcome": "deferred", "roomId": "r1"]) { $1 }))

    // Paid: straight to the tour, with location already deferred.
    let paid = ada.merging(["races": [unpaidRace.merging(["entitlementStatus": "paid"]) { $1 }]]) { $1 }
    read = try state(try await runtime(paid.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["phase"] as? String == "tour")
    #expect(read["step"] as? String == "invites")
    #expect(read["showsTabBar"] as? Bool == true)
    // Paid: course and start time are checklist items, so they never hide the tab bar.
    #expect((read["checklist"] as? [[String: Any]])?.compactMap { $0["step"] as? String } == ["course", "startTime", "etaEdits", "checkpointDetails"])

    // Sign-out wipes the storage root; the progress stays.
    _ = try result(try await runtime(["op": "wipeUserData", "storageDir": storage]))
    try? FileManager.default.removeItem(atPath: storage)
    read = try state(try await runtime(withRace.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["step"] as? String == "projectionTeaser")

    let racesReset = try result(try await runtime(ada.merging(["op": "resetOnboarding", "roomId": "r1"]) { $1 }))
    #expect(((racesReset["progress"] as? [String: Any])?["races"] as? [String: Any])?.isEmpty == true)
    _ = try result(try await runtime(ada.merging(["op": "resetOnboarding"]) { $1 }))
    read = try state(try await runtime(ada.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["flow"] as? String == "chooser")

    // A pending invite from the app's join store gives the crew flow.
    read = try state(try await runtime(signedOut.merging(["op": "readOnboarding", "hasPendingInvite": true]) { $1 }))
    #expect(read["flow"] as? String == "crew")
    #expect(read["step"] as? String == "join")
}

private struct MineServer: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard request.url.path == "/race-rooms/mine" else { return HTTPResponse(status: 404, body: Data("{}".utf8)) }
        var room = try #require((demoRoomObject()["room"]) as? [String: Any])
        room["pacingEstimateId"] = "est-1"
        var crew = room
        crew["pacingEstimateId"] = nil
        crew["pacingEstimate"] = nil
        crew["id"] = "r2"
        crew["athleteId"] = "someone"
        crew["course"] = nil
        crew["memberships"] = [["userId": "runner-1", "role": "crew_member", "joinedAt": "2026-08-01T00:00:00.000Z"]]
        crew["entitlement"] = ["status": "paid", "lastUpdatedAt": "2026-08-01T00:00:00.000Z", "source": "store"]
        crew["raceStartAt"] = nil
        crew["activatedAt"] = "2026-08-14T12:00:00.000Z"
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: ["rooms": [room, crew]]))
    }
}

@Test func onboardingRuntimeResolvesWithoutTheRaceList() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("onboarding-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let ada: [String: Any] = ["storageDir": storage, "userId": "ada", "token": "t"]

    // Signed in, `myRaces` hasn't answered, nothing saved: loading, with the tab bar only for a stored race.
    var read = try state(try await runtime(ada.merging(["op": "readOnboarding"]) { $1 }))
    #expect(read["flow"] as? String == "loading")
    #expect(read["showsTabBar"] as? Bool == false)
    read = try state(try await runtime(ada.merging(["op": "readOnboarding", "activeRoomId": "r2", "races": NSNull()]) { $1 }))
    #expect(read["flow"] as? String == "loading")
    #expect(read["showsTabBar"] as? Bool == true)

    // The list answers once: a paid crew race, mid-tour (the account has saved progress already).
    _ = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "step": "account"]) { $1 }))
    let crewRace: [String: Any] = ["id": "r2", "role": "crew_member", "entitlementStatus": "paid", "hasCourse": true]
    read = try state(try await runtime(ada.merging(["op": "readOnboarding", "races": [crewRace], "activeRoomId": "r2"]) { $1 }))
    #expect(read["flow"] as? String == "crew" && read["step"] as? String == "runnerLocation")
    _ = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "step": "runnerLocation", "roomId": "r2"]) { $1 }))

    // Relaunched with no service: the saved list resolves the same race and keeps the tab bar.
    read = try state(try await runtime(ada.merging(["op": "readOnboarding", "activeRoomId": "r2"]) { $1 }))
    #expect(read["flow"] as? String == "crew")
    #expect(read["step"] as? String == "lastUpdateAge")
    #expect(read["roomId"] as? String == "r2")
    #expect(read["showsTabBar"] as? Bool == true)

    // A legacy race with only `activatedAt` has a start time.
    let legacy: [String: Any] = [
        "id": "r1", "role": "athlete", "entitlementStatus": "unpaid", "activatedAt": "2026-08-15T12:00:00.000Z", "hasCourse": true
    ]
    _ = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "step": "account"]) { $1 }))
    read = try state(try await runtime(ada.merging(["op": "readOnboarding", "races": [legacy]]) { $1 }))
    #expect(read["step"] as? String == "history")
}

@Test func onboardingRuntimeConfirmsOneInvite() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("onboarding-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let signedOut: [String: Any] = ["storageDir": storage, "userId": ""]
    let missing = try await runtime(signedOut.merging(["op": "markOnboardingStep", "step": "join"]) { $1 })
    #expect(missing["ok"] as? Bool == false)
    #expect(missing["message"] as? String == OnboardingError.inviteRequired.message)
    let marked = try state(try await runtime(signedOut.merging([
        "op": "markOnboardingStep", "step": "join", "invite": "tok-a", "pendingInvite": "tok-a"
    ]) { $1 }))
    #expect(marked["step"] as? String == "account")
    #expect(marked["inviteConfirmed"] as? Bool == true)
    let other = try state(try await runtime(signedOut.merging(["op": "readOnboarding", "pendingInvite": "tok-b"]) { $1 }))
    #expect(other["step"] as? String == "join")
    #expect(other["inviteConfirmed"] as? Bool == false)
}

private let deletedBody = Data(#"""
{"deleted":true,"roomsClosed":0,"membershipsRemoved":0,"activityHistoryDeleted":0,"pacingEstimatesDeleted":0,
 "finishedEffortsDeleted":0,"pushDevicesDeleted":0,"chatPrefsDeleted":0,"stravaDisconnected":false,"identityProvider":"deleted"}
"""#.utf8)

private struct DeleteMeServer: HTTPTransport {
    let status: Int
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard request.url.path == "/me", request.method == .delete else { return HTTPResponse(status: 404, body: Data("{}".utf8)) }
        return HTTPResponse(status: status, body: status == 200 ? deletedBody : Data("{}".utf8))
    }
}

@Test func deleteAccountRuntimeOpRemovesTheOnboardingProgress() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("onboarding-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true)
    let store = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: storage))
    try store.mark(.account, userId: "ada")
    try store.choose(.crew, userId: nil)
    let failing = "https://delete-fail-\(UUID().uuidString.lowercased()).example.invalid"
    let base = "https://delete-\(UUID().uuidString.lowercased()).example.invalid"
    RuntimeCall.setTransportForTests(DeleteMeServer(status: 500), baseURL: failing)
    RuntimeCall.setTransportForTests(DeleteMeServer(status: 200), baseURL: base)
    defer {
        RuntimeCall.setTransportForTests(nil, baseURL: failing)
        RuntimeCall.setTransportForTests(nil, baseURL: base)
    }
    let request: [String: Any] = ["op": "deleteAccount", "token": "t", "userId": "ada", "storageDir": storage.path]

    // Not deleted: the progress stays.
    let failed = try result(try await runtime(request.merging(["baseURL": failing]) { $1 }))
    #expect(failed["deleted"] as? Bool == false)
    #expect(FileManager.default.fileExists(atPath: store.file(userId: "ada").path))

    let deleted = try result(try await runtime(request.merging(["baseURL": base]) { $1 }))
    #expect(deleted["deleted"] as? Bool == true)
    #expect(!FileManager.default.fileExists(atPath: store.file(userId: "ada").path))
    // The signed-out file is not the deleted account's.
    #expect(store.load(userId: nil).choice == .crew)
}

@Test func accountDeletionRemovesTheSessionUsersOnboardingProgress() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("onboarding-del-\(UUID().uuidString)", isDirectory: true)
    let store = OnboardingStore(directory: directory)
    try store.mark(.account, userId: "ada")
    let graph = ClientGraph(
        transport: DeleteMeServer(status: 200), clock: SystemClock(), logger: SilentLogger(),
        baseURL: URL(string: "https://api.example.test"), tokenProvider: StaticTokenProvider(token: "jwt"),
        session: SessionController(session: ClientSession(userId: "ada", role: "athlete"))
    )
    #expect(await AccountDeletion.run(graph: graph, onboarding: store) == .deleted(identityProvider: "deleted"))
    #expect(!FileManager.default.fileExists(atPath: store.file(userId: "ada").path))
}

@Test func myRacesRowsCarryWhatOnboardingReads() async throws {
    let base = "https://mine-\(UUID().uuidString.lowercased()).example.invalid"
    RuntimeCall.setTransportForTests(MineServer(), baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    let storage = FileManager.default.temporaryDirectory.appendingPathComponent("mine-\(UUID().uuidString)/crewcue-user").path
    let mine = try result(try await runtime(["op": "myRaces", "baseURL": base, "token": "t", "userId": "runner-1", "storageDir": storage]))
    let rows = try #require(mine["races"] as? [[String: Any]])
    #expect(rows.compactMap { $0["entitlementStatus"] as? String } == ["unpaid", "paid"])
    #expect(rows.compactMap { $0["hasCourse"] as? Bool } == [true, false])
    #expect(rows.compactMap { $0["hasEstimate"] as? Bool } == [true, false])
    #expect(rows.compactMap { $0["role"] as? String } == ["athlete", "crew_member"])
    #expect(rows.compactMap { $0["activatedAt"] as? String } == ["2026-08-14T12:00:00.000Z"])
    // Delete race: only the owner is offered it, and a paid race warns that its pass goes too.
    #expect(rows.compactMap { $0["owner"] as? Bool } == [true, false])
    #expect(rows.compactMap { $0["paid"] as? Bool } == [false, true])

    // The rows go straight back to readOnboarding: the crew race is the crew flow.
    _ = try result(try await runtime(["op": "markOnboardingStep", "step": "account", "storageDir": storage, "userId": "runner-1"]))
    let read = try state(try await runtime([
        "op": "readOnboarding", "storageDir": storage, "userId": "runner-1", "races": rows, "activeRoomId": "r2"
    ]))
    #expect(read["flow"] as? String == "crew")
    #expect(read["step"] as? String == "runnerLocation")
    // The saved list keeps whether each race has an estimate (runner setup's history step reads it).
    let saved = OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: URL(fileURLWithPath: storage, isDirectory: true)))
    #expect(saved.load(userId: "runner-1").knownRaces?.map(\.hasEstimate) == [true, false])
}

@Test func onboardingRuntimeSharesToursAcrossRacesAndLocksUnpaidCrew() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("onboarding-rt-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    let ada: [String: Any] = ["storageDir": storage, "userId": "ada", "token": "t"]
    _ = try result(try await runtime(ada.merging(["op": "markOnboardingStep", "step": "account"]) { $1 }))
    let first: [String: Any] = ["id": "c1", "role": "crew_member", "entitlementStatus": "paid", "hasCourse": true]
    let second: [String: Any] = ["id": "c2", "role": "crew_member", "entitlementStatus": "paid", "hasCourse": true]
    let races = [first, second]

    // Finishing the crew tour in c1 finishes it in c2; `notifications` takes its role from the race.
    for step in OnboardingStep.crewTour {
        _ = try result(try await runtime(ada.merging([
            "op": "markOnboardingStep", "step": step.rawValue, "roomId": "c1", "races": races, "activeRoomId": "c1"
        ]) { $1 }))
    }
    let read = try state(try await runtime(ada.merging(["op": "readOnboarding", "races": races, "activeRoomId": "c2"]) { $1 }))
    #expect(read["flow"] as? String == "done" && read["roomId"] as? String == "c2")
    #expect(read["reason"] is NSNull)
    let progress = try result(try await runtime(ada.merging(["op": "readOnboarding", "races": races]) { $1 }))["progress"] as? [String: Any]
    let tours = try #require(progress?["tours"] as? [String: Any])
    #expect((tours["crew"] as? [String: Any])?["notifications"] as? String == "done")
    #expect(tours["runner"] == nil)

    // A crew member whose race went unpaid: locked, tab bar, a reason.
    var locked = second
    locked["entitlementStatus"] = "unpaid"
    let lockedRead = try state(try await runtime(ada.merging(["op": "readOnboarding", "races": [first, locked], "activeRoomId": "c2"]) { $1 }))
    #expect(lockedRead["flow"] as? String == "raceLocked")
    #expect(lockedRead["showsTabBar"] as? Bool == true)
    #expect(lockedRead["step"] is NSNull)
    #expect(lockedRead["reason"] as? String == "Waiting for the runner to unlock this race.")

    // An existing account: a first loaded list with a paid race, no progress, both tours done.
    let existing: [String: Any] = ["storageDir": storage, "userId": "old", "token": "t"]
    let paidRunner: [String: Any] = ["id": "r9", "role": "athlete", "entitlementStatus": "paid", "hasCourse": true]
    let old = try state(try await runtime(existing.merging(["op": "readOnboarding", "races": [paidRunner]]) { $1 }))
    #expect(old["flow"] as? String == "done" && old["showsTabBar"] as? Bool == true)
    let unknown = try state(try await runtime(["storageDir": storage, "userId": "new", "token": "t", "op": "readOnboarding"]))
    #expect(unknown["flow"] as? String == "loading")
}
