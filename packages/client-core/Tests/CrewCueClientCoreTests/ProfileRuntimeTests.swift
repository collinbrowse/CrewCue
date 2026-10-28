import Foundation
import Testing
@testable import CrewCueClientCore

@Test func coursePayloadKeepsRosterBesideTheCourse() throws {
    let json = """
    {"room":{
      "athleteId":"a",
      "memberships":[
        {"userId":"a","role":"athlete","joinedAt":"2026-08-15T13:00:00.000Z","displayName":"Ada"},
        {"userId":"b","role":"crew_member","joinedAt":"2026-08-15T13:00:00.000Z","displayName":"  "}
      ],
      "course":{"checkpoints":[
        {"id":"aid-1","title":"Aid 1","latitude":40.0,"longitude":-105.0,"distanceMetersFromStart":0}
      ]}
    }}
    """
    let payload = CoursePayload.make(from: Data(json.utf8))
    let checkpoints = try #require(payload["checkpoints"] as? [[String: Any]])
    #expect((checkpoints.first?["title"] as? String) == "AID 1")
    let members = try #require(payload["memberships"] as? [[String: Any]])
    #expect(members.count == 2)
    #expect((members[0]["displayName"] as? String) == "Ada")
    #expect((members[0]["userId"] as? String) == "a")
    #expect(members[1]["displayName"] == nil)
    #expect((members[1]["userId"] as? String) == "b")
    #expect((payload["athleteId"] as? String) == "a")
}

@Test func runtimeProfileOpsRequireBaseURL() async throws {
    let ops = [
        "updateDisplayName",
        "removeMember",
        "incidents",
        "createIncident",
        "stravaStart",
        "stravaConnection",
        "stravaDisconnect"
    ]
    for op in ops {
        let response = try await profileRuntime([
            "op": op,
            "roomId": "room",
            "memberUserId": "athlete-1",
            "displayName": "Ada",
            "category": "other",
            "severity": "low",
            "summary": "Blister",
            "checkpointId": "aid-1"
        ])
        #expect(flag(response, "ok") == false)
        #expect((response["message"] as? String) == "baseURL is required.")
        #expect((response["message"] as? String)?.contains("Unknown runtime op") == false)
    }
}

private func profileRuntime(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func flag(_ object: [String: Any], _ key: String) -> Bool {
    if let value = object[key] as? Bool { return value }
    if let value = object[key] as? NSNumber { return value.boolValue }
    return false
}
