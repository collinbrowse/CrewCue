import Foundation
import Testing
@testable import CrewCueClientCore

private let room = "4f3c2a10-8d1e-4c55-9a4b-2f0e6d7c8b91"

private func runtime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    let answer = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(answer["ok"] as? Bool == true, "\(raw)")
    return try #require(answer["result"] as? [String: Any])
}

/// A `myRaces` row as Android keeps it: the summary plus display fields.
private func row(_ id: String = room, role: String = "athlete", owner: String = "u1", paid: Bool = false) -> [String: Any] {
    ["id": id, "name": "Leadville 100", "role": role, "ownerId": owner, "paid": paid, "roleLabel": "Runner", "hasCourse": true]
}

@Test func runtimePushTapReceiveReadsTheFcmDataKeys() async throws {
    let unlock = try await runtime(["op": "pushTapReceive", "type": "unlock", "roomId": " \(room) "])
    let inbox = try #require(unlock["inbox"] as? [String: Any])
    #expect(inbox["type"] as? String == "unlock")
    #expect(inbox["roomId"] as? String == room)
    #expect(inbox["listedSinceTap"] as? Bool == false)
    // No type: a chat push sent before kinds existed.
    let chat = try await runtime(["op": "pushTapReceive", "roomId": room])
    #expect((chat["inbox"] as? [String: Any])?["type"] as? String == "chat")
    for fields: [String: Any] in [
        ["type": "schedule", "roomId": room],
        ["type": "tracking", "roomId": ""],
        ["type": "tracking"],
        ["type": 3, "roomId": room]
    ] {
        var request = fields
        request["op"] = "pushTapReceive"
        #expect(try await runtime(request)["inbox"] is NSNull, "\(fields)")
    }
}

@Test func runtimePushTapTakeOpensTheDestinationAndClearsTheInbox() async throws {
    func take(_ type: String, races: [[String: Any]], signedIn: Bool = true) async throws -> [String: Any] {
        let inbox = try #require(try await runtime(["op": "pushTapReceive", "type": type, "roomId": room])["inbox"])
        return try await runtime([
            "op": "pushTapTake", "inbox": inbox, "signedIn": signedIn, "userId": "u1", "races": races
        ])
    }
    let unlock = try await take("unlock", races: [row()])
    #expect(unlock["resolution"] as? String == "open")
    #expect(unlock["roomId"] as? String == room)
    #expect(unlock["destination"] as? String == "paywall")
    #expect(unlock["inbox"] is NSNull)
    #expect(try await take("tracking", races: [row()])["destination"] as? String == "startTracking")
    #expect(try await take("chat", races: [row()])["destination"] as? String == "chat")
    #expect(try await take("unlock", races: [row(paid: true)])["destination"] as? String == "map")
    #expect(try await take("tracking", races: [row(role: "crew_member", owner: "runner")])["destination"] as? String == "map")

    let signedOut = try await take("unlock", races: [], signedIn: false)
    #expect(signedOut["resolution"] as? String == "holdUntilSignIn")
    #expect((signedOut["inbox"] as? [String: Any])?["roomId"] as? String == room)
}

@Test func runtimePushTapTakeWaitsForTheListThenDrops() async throws {
    let inbox = try #require(try await runtime(["op": "pushTapReceive", "type": "tracking", "roomId": room])["inbox"])
    let waiting = try await runtime(["op": "pushTapTake", "inbox": inbox, "signedIn": true, "userId": "u1"])
    #expect(waiting["resolution"] as? String == "awaitRaces")
    let held = try #require(waiting["inbox"] as? [String: Any])
    #expect(held["listedSinceTap"] as? Bool == false)
    // The list answered without the race: another account's push.
    let dropped = try await runtime([
        "op": "pushTapTake", "inbox": held, "signedIn": true, "userId": "u1",
        "races": [row("theirs")], "racesListed": true
    ])
    #expect(dropped["resolution"] as? String == "drop")
    #expect(dropped["inbox"] is NSNull)
    // The list answered with the race.
    let opened = try await runtime([
        "op": "pushTapTake", "inbox": held, "signedIn": true, "userId": "u1",
        "races": [row()], "racesListed": true
    ])
    #expect(opened["destination"] as? String == "startTracking")
    #expect(try await runtime(["op": "pushTapTake", "signedIn": true])["resolution"] as? String == "none")
}

@Test func runtimeUnpaidExpiryUsesTheSharedCopy() async throws {
    let now = "2026-11-25T12:00:00.000Z"
    #expect(try await runtime(["op": "unpaidExpiry", "expiresAt": "2026-12-02T12:00:00.000Z", "now": now])["text"] as? String
        == "Expires in 7 days")
    #expect(try await runtime(["op": "unpaidExpiry", "expiresAt": "2026-11-25T13:00:00.000Z", "now": now])["text"] as? String
        == "Expires in 1 day")
    #expect(try await runtime(["op": "unpaidExpiry", "expiresAt": "2026-11-24T12:00:00.000Z", "now": now])["text"] is NSNull)
    #expect(try await runtime(["op": "unpaidExpiry", "now": now])["text"] is NSNull)
    // Without `now`, the clock: a date a month out is still days away.
    let month = ISO8601DateFormatter().string(from: Date().addingTimeInterval(30 * 86_400 + 60))
    #expect(try await runtime(["op": "unpaidExpiry", "expiresAt": month])["text"] as? String == "Expires in 30 days")
}
