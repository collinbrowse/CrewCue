import Foundation
import Testing
@testable import CrewCueClientCore

@Test func runtimeChatStaysPendingUntilComplete() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let first = try await chatRuntime([
        "op": "enqueueChat",
        "storageDir": directory.path,
        "userId": "crew-1",
        "role": "crew_member",
        "roomId": "room",
        "text": "See @Ada",
        "clientMessageId": "m-stable"
    ])
    #expect(flag(first, "ok") == true)
    let queued = try resultObject(first)
    #expect((queued["status"] as? String) == "pending")
    #expect((queued["id"] as? String) == "m-stable")
    #expect((queued["clientMessageId"] as? String) == "m-stable")

    let second = try await chatRuntime([
        "op": "enqueueChat",
        "storageDir": directory.path,
        "userId": "crew-1",
        "role": "crew_member",
        "roomId": "room",
        "text": "Second",
        "clientMessageId": "m-2"
    ])
    #expect(flag(second, "ok") == true)

    let store = try OutboxStore.shared(userId: "crew-1", directory: UserStorage(root: directory).directory(userId: "crew-1"))
    let pending = try await store.operations()
    #expect(Set(pending.map(\.id)) == ["m-stable", "m-2"])
    #expect(pending.allSatisfy { $0.type == "chat" && $0.status == "pending" })

    let flushed = try await chatRuntime([
        "op": "flushOutbox",
        "storageDir": directory.path,
        "userId": "crew-1",
        "baseURL": "https://example.invalid",
        "token": "token"
    ])
    #expect(flag(flushed, "ok") == true)
    let report = try resultObject(flushed)
    let stillPending = try #require(report["pending"] as? [String])
    #expect(Set(stillPending) == ["m-stable", "m-2"])
    #expect(try await store.operations().count == 2)

    let done = try await chatRuntime([
        "op": "completeOutbox",
        "storageDir": directory.path,
        "userId": "crew-1",
        "id": "m-stable"
    ])
    #expect(flag(done, "ok") == true)
    let remaining = try await store.operations()
    #expect(remaining.map(\.id) == ["m-2"])
    #expect(remaining.first?.status == "pending")
}

@Test func runtimeEnqueueChatReplacesTheSameClientMessageId() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let fields: [String: Any] = [
        "op": "enqueueChat",
        "storageDir": directory.path,
        "userId": "crew-1",
        "role": "crew_member",
        "roomId": "room",
        "text": "One",
        "clientMessageId": "same"
    ]
    _ = try await chatRuntime(fields)
    var again = fields
    again["text"] = "Two"
    _ = try await chatRuntime(again)
    let store = try OutboxStore.shared(userId: "crew-1", directory: UserStorage(root: directory).directory(userId: "crew-1"))
    let operations = try await store.operations()
    #expect(operations.count == 1)
    #expect(operations.first?.clientMessageId == "same")
    #expect(operations.first?.payloadJSON.contains("Two") == true)
}

@Test func runtimeEnqueuePushUsesAndroidPlatform() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let queued = try await chatRuntime([
        "op": "enqueuePush",
        "storageDir": directory.path,
        "userId": "crew-1",
        "role": "crew_member",
        "deviceId": "device-1",
        "platform": "android",
        "token": "fcm-1"
    ])
    #expect(flag(queued, "ok") == true)
    #expect((try resultObject(queued)["id"] as? String) == "push-device-1")
    #expect((try resultObject(queued)["platform"] as? String) == "android")

    _ = try await chatRuntime([
        "op": "enqueuePush",
        "storageDir": directory.path,
        "userId": "crew-1",
        "role": "crew_member",
        "deviceId": "device-1",
        "platform": "android",
        "token": "fcm-2"
    ])
    let store = try OutboxStore.shared(userId: "crew-1", directory: UserStorage(root: directory).directory(userId: "crew-1"))
    let operations = try await store.operations()
    #expect(operations.count == 1)
    #expect(operations.first?.type == "push")
    #expect(operations.first?.status == "pending")
    #expect(operations.first?.payloadJSON.contains("\"platform\":\"android\"") == true)
    #expect(operations.first?.payloadJSON.contains("fcm-2") == true)
}

@Test func runtimeChatOpsRejectMissingStorageOrBadPreference() async throws {
    let missing = try await chatRuntime(["op": "enqueueChat", "roomId": "room", "text": "Hi", "clientMessageId": "m"])
    #expect(flag(missing, "ok") == false)
    #expect((missing["message"] as? String) == "storageDir is required.")

    let push = try await chatRuntime(["op": "enqueuePush", "deviceId": "d", "token": "t"])
    #expect(flag(push, "ok") == false)

    let preference = try await chatRuntime([
        "op": "saveNotificationPreference",
        "roomId": "room",
        "preference": "loud"
    ])
    #expect(flag(preference, "ok") == false)
    #expect((preference["message"] as? String) == "Couldn't save alert settings.")

    for op in ["streamToken", "parseMentions", "notificationPreference"] {
        let response = try await chatRuntime(["op": op, "roomId": "room", "body": "@Ada"])
        #expect(flag(response, "ok") == false)
        #expect((response["message"] as? String) == "baseURL is required.")
        #expect((response["message"] as? String)?.contains("Unknown runtime op") == false)
    }
}

private func chatRuntime(_ fields: [String: Any]) async throws -> [String: Any] {
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
