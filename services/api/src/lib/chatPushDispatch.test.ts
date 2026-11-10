import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_PUSH_PREVIEW_MAX_CHARS,
  GENERIC_CHAT_PUSH_BODY,
  chatPushBody,
  dispatchChatPush,
  resetChatPushTransport,
  setChatPushTransport,
  transportFromEnv,
  type ChatPushDispatchInput
} from "./chatPushDispatch.js";
import {
  _resetChatPersistenceForTests,
  listChatPushDevicesForUsers,
  upsertChatPushDevice
} from "./chatPersistence.js";

test("dispatchChatPush falls back to generic copy for an empty body", async () => {
  const captured: ChatPushDispatchInput[] = [];
  setChatPushTransport(async (input) => {
    captured.push(input);
    return { delivered: input.targets.length, attempts: input.targets.length, failures: [], invalidDeviceIds: [] };
  });
  try {
    await dispatchChatPush({
      roomId: "room-1",
      title: "Leadville 100",
      body: "  ",
      targets: [{ platform: "ios", token: "t", userId: "u", deviceId: "d" }]
    });
    assert.equal(captured[0]?.body, GENERIC_CHAT_PUSH_BODY);
    assert.equal(captured[0]?.kind, "chat");
  } finally {
    resetChatPushTransport();
  }
});

test("dispatchChatPush skips the transport when there are no targets", async () => {
  let called = false;
  setChatPushTransport(async () => {
    called = true;
    return { delivered: 0, attempts: 0, failures: [], invalidDeviceIds: [] };
  });
  try {
    const result = await dispatchChatPush({ roomId: "r", title: "t", body: "b", targets: [] });
    assert.equal(called, false);
    assert.equal(result.attempts, 0);
  } finally {
    resetChatPushTransport();
  }
});

test("dispatchChatPush prunes devices the provider rejected", async () => {
  _resetChatPersistenceForTests();
  const now = new Date().toISOString();
  await upsertChatPushDevice({ deviceId: "dead", userId: "u1", platform: "android", token: "old", registeredAt: now });
  await upsertChatPushDevice({ deviceId: "alive", userId: "u1", platform: "ios", token: "new", registeredAt: now });
  setChatPushTransport(async () => ({
    delivered: 1,
    attempts: 2,
    failures: [{ deviceId: "dead", reason: "UNREGISTERED" }],
    invalidDeviceIds: ["dead"]
  }));
  try {
    const devices = await listChatPushDevicesForUsers(["u1"]);
    await dispatchChatPush({
      roomId: "r",
      title: "t",
      body: "b",
      targets: devices.map((d) => ({ platform: d.platform, token: d.token, userId: d.userId, deviceId: d.deviceId }))
    });
    const left = await listChatPushDevicesForUsers(["u1"]);
    assert.deepEqual(left.map((d) => d.deviceId), ["alive"]);
  } finally {
    resetChatPushTransport();
  }
});

test("chatPushBody names the sender and trims long previews", () => {
  assert.equal(chatPushBody("Ada", "on my way", false), "Ada: on my way");
  assert.equal(chatPushBody("Ada", "", true), "Ada sent a photo");
  const long = chatPushBody("Ada", "x".repeat(500), false);
  assert.equal(long.length, "Ada: ".length + CHAT_PUSH_PREVIEW_MAX_CHARS);
  assert.ok(long.endsWith("…"));
});

test("transportFromEnv logs only when APNs and FCM are unconfigured", async () => {
  const transport = transportFromEnv({});
  const result = await transport({
    roomId: "r",
    title: "t",
    body: "b",
    targets: [{ platform: "ios", token: "t", userId: "u", deviceId: "d" }]
  });
  assert.equal(result.delivered, 0);
  assert.deepEqual(result.invalidDeviceIds, []);
});
