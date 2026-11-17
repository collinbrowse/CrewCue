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
    #expect(chosen["state"] == nil)
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
    #expect((read["checklist"] as? [[String: Any]])?.count == 2)

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
        let room = try #require((demoRoomObject()["room"]) as? [String: Any])
        var crew = room
        crew["id"] = "r2"
        crew["athleteId"] = "someone"
        crew["course"] = nil
        crew["memberships"] = [["userId": "runner-1", "role": "crew_member", "joinedAt": "2026-08-01T00:00:00.000Z"]]
        crew["entitlement"] = ["status": "paid", "lastUpdatedAt": "2026-08-01T00:00:00.000Z", "source": "store"]
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: ["rooms": [room, crew]]))
    }
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
    #expect(rows.compactMap { $0["role"] as? String } == ["athlete", "crew_member"])

    // The rows go straight back to readOnboarding: the crew race is the crew flow.
    let read = try state(try await runtime([
        "op": "readOnboarding", "storageDir": storage, "userId": "runner-1", "races": rows, "activeRoomId": "r2"
    ]))
    #expect(read["flow"] as? String == "crew")
    #expect(read["step"] as? String == "runnerLocation")
}
