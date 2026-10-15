import Foundation
import Testing
@testable import CrewCueClientCore

@Test func coursePayloadUsesWorkspaceLineAndCheckpointTitles() throws {
    let json = """
    {"room":{"course":{"checkpoints":[
      {"id":"aid-2","title":"Aid 2","latitude":40.2,"longitude":-105.2,"distanceMetersFromStart":2000},
      {"id":"aid-1","title":"Aid 1","latitude":40.0,"longitude":-105.0,"distanceMetersFromStart":0}
    ]},
    "mapWorkspace":{"drivesProjectionLayerId":"course","layers":[
      {"id":"course","visible":true,"geometry":{"type":"LineString","coordinates":[[-105.0,40.0],[-105.05,40.05],[-105.1,40.1]]}}
    ]}}}
    """
    let payload = CoursePayload.make(from: Data(json.utf8))
    #expect(flag(payload, "offline") == false)
    let line = try #require(payload["line"] as? [[Double]])
    #expect(line.count == 3)
    let checkpoints = try #require(payload["checkpoints"] as? [[String: Any]])
    #expect(checkpoints.count == 2)
    let first = try #require(checkpoints.first)
    #expect((first["id"] as? String) == "aid-1")
    #expect((first["title"] as? String) == "AID 1")
}

@Test func coursePayloadIsEmptyWithoutCheckpointsOrLine() {
    let payload = CoursePayload.make(from: Data(#"{"room":{"course":{"checkpoints":[]}}}"#.utf8))
    #expect((payload["checkpoints"] as? [[String: Any]])?.isEmpty == true)
    #expect((payload["line"] as? [[Double]])?.isEmpty == true)
}

@Test func runtimeEnqueuePingIncreasesRecordedAtAndSkipsCrew() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let first = try await runtimeCall([
        "op": "enqueuePing",
        "storageDir": directory.path,
        "userId": "athlete-1",
        "role": "athlete",
        "roomId": "room",
        "latitude": 40.0,
        "longitude": -105.0,
        "recordedAt": "2026-08-15T14:10:00.000Z"
    ])
    let queued = try resultObject(first)
    #expect((queued["status"] as? String) == "queued")
    #expect((queued["recordedAt"] as? String) == "2026-08-15T14:10:00.000Z")

    let later = try await runtimeCall([
        "op": "enqueuePing",
        "storageDir": directory.path,
        "userId": "athlete-1",
        "role": "athlete",
        "roomId": "room",
        "latitude": 40.1,
        "longitude": -105.1,
        "recordedAt": "2026-08-15T14:11:00.000Z"
    ])
    #expect((try resultObject(later)["recordedAt"] as? String) == "2026-08-15T14:11:00.000Z")

    let stale = try await runtimeCall([
        "op": "enqueuePing",
        "storageDir": directory.path,
        "userId": "athlete-1",
        "role": "athlete",
        "roomId": "room",
        "latitude": 40.0,
        "longitude": -105.0,
        "recordedAt": "2026-08-15T14:09:00.000Z"
    ])
    #expect(flag(stale, "ok") == false)
    #expect((stale["message"] as? String) == "recordedAt must increase.")

    let crew = try await runtimeCall([
        "op": "enqueuePing",
        "storageDir": directory.path,
        "userId": "crew-1",
        "role": "crew_member",
        "roomId": "room",
        "latitude": 40.0,
        "longitude": -105.0,
        "recordedAt": "2026-08-15T14:12:00.000Z"
    ])
    #expect(flag(crew, "ok") == false)
    #expect((crew["message"] as? String) == "Only the athlete uploads location.")
}

@Test func runtimeMapOpsRejectMissingBaseURL() async throws {
    for op in ["loadRoom", "placeCheckpoint", "route"] {
        let response = try await runtimeCall(["op": op, "roomId": "room"])
        #expect(flag(response, "ok") == false)
        #expect((response["message"] as? String) == "baseURL is required.")
    }
}

private func runtimeCall(_ fields: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: fields)
    let raw = await RuntimeCall.perform(String(decoding: data, as: UTF8.self))
    return try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
}

private func resultObject(_ root: [String: Any]) throws -> [String: Any] {
    try #require(root["result"] as? [String: Any])
}

private func flag(_ object: [String: Any], _ key: String) -> Bool {
    if let value = object[key] as? Bool { return value }
    if let value = object[key] as? NSNumber { return value.boolValue }
    return false
}
