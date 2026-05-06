import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_CHAT_PUSH_BODY,
  dispatchChatPush,
  resetChatPushTransport,
  setChatPushTransport
} from "./chatPushDispatch.js";

test("chatPushDispatch: routes through the configured transport", async () => {
  const dispatched: Array<{ targetCount: number; fallback: string | undefined }> = [];
  setChatPushTransport(async (input) => {
    dispatched.push({ targetCount: input.targets.length, fallback: input.genericFallback });
    return { delivered: input.targets.length, attempts: input.targets.length, failures: [] };
  });
  const result = await dispatchChatPush({
    channelId: "crew-room-1",
    roomId: "room-1",
    encryptedPreview: { ciphertext: "ct", nonce: "n", keyVersion: 1 },
    targets: [
      { platform: "ios", token: "apns-1", userId: "u-1", deviceId: "d-1" },
      { platform: "android", token: "fcm-1", userId: "u-2", deviceId: "d-2" }
    ]
  });
  assert.equal(result.delivered, 2);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.targetCount, 2);
  assert.equal(dispatched[0]?.fallback, GENERIC_CHAT_PUSH_BODY);
  resetChatPushTransport();
});

test("chatPushDispatch: default transport returns delivered=targets.length", async () => {
  resetChatPushTransport();
  const result = await dispatchChatPush({
    channelId: "crew-room-2",
    roomId: "room-2",
    encryptedPreview: { ciphertext: "ct", nonce: "n", keyVersion: 1 },
    targets: [{ platform: "ios", token: "apns-2", userId: "u-3", deviceId: "d-3" }]
  });
  assert.equal(result.delivered, 1);
  assert.equal(result.failures.length, 0);
});
