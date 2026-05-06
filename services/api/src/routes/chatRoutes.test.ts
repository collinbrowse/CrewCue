import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { _resetChatPersistenceForTests } from "../lib/chatPersistence.js";

function buildClaims(sub: string, teamIds: string[] = ["team-chat"]) {
  return { sub, teamIds, roomRoles: {} };
}

async function createActivatedRoom(
  app: ReturnType<typeof buildApp>,
  athleteToken: string,
  athleteSub: string
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-chat",
      athleteId: athleteSub,
      name: "Chat Test Room",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(created.statusCode, 201);
  const roomId = (created.json() as { id: string }).id;

  const pay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(pay.statusCode, 200);

  const activate = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: { eventEndsAt: new Date(Date.now() + 60_000).toISOString() },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(activate.statusCode, 200);
  return roomId;
}

test("chat: device key registration requires auth and persists", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/chat/devices",
      payload: { deviceId: "dev-1", publicKey: "pk-1" }
    });
    assert.equal(unauthorized.statusCode, 401);

    const token = app.jwt.sign(buildClaims("user-a"));
    const ok = await app.inject({
      method: "POST",
      url: "/chat/devices",
      payload: { deviceId: "dev-1", publicKey: "pk-1" },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(ok.statusCode, 201);
    const body = ok.json() as { userId: string; publicKey: string };
    assert.equal(body.userId, "user-a");
    assert.equal(body.publicKey, "pk-1");

    const lookup = await app.inject({
      method: "GET",
      url: "/chat/users/user-a/devices",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(lookup.statusCode, 200);
    const devices = (lookup.json() as { devices: Array<{ deviceId: string }> }).devices;
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.deviceId, "dev-1");
  } finally {
    await app.close();
  }
});

test("chat: stream-token returns 503 when stream credentials missing", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-x"));
    const res = await app.inject({
      method: "POST",
      url: "/chat/stream-token",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 503);
  } finally {
    await app.close();
  }
});

test("chat: stream-token returns signed JWT when credentials configured", async () => {
  _resetChatPersistenceForTests();
  process.env.STREAM_API_KEY = "test-key";
  process.env.STREAM_API_SECRET = "test-secret";
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-y"));
    const res = await app.inject({
      method: "POST",
      url: "/chat/stream-token",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { token: string; streamUserId: string; streamApiKey: string };
    assert.equal(body.streamUserId, "user-y");
    assert.equal(body.streamApiKey, "test-key");
    const parts = body.token.split(".");
    assert.equal(parts.length, 3);
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    assert.equal(payload.user_id, "user-y");
    assert.equal(typeof payload.exp, "number");
  } finally {
    delete process.env.STREAM_API_KEY;
    delete process.env.STREAM_API_SECRET;
    await app.close();
  }
});

test("chat: key-envelope upload requires room membership", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-1"));
    const outsiderToken = app.jwt.sign(buildClaims("outsider-1"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-1");

    const denied = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      payload: {
        envelopes: [
          {
            recipientUserId: "athlete-1",
            recipientDeviceId: "dev-A",
            senderEphemeralPublicKey: "ephK",
            nonce: "n1",
            ciphertext: "ct1",
            keyVersion: 1
          }
        ]
      },
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    assert.equal(denied.statusCode, 403);

    const ok = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/key-envelopes`,
      payload: {
        envelopes: [
          {
            recipientUserId: "athlete-1",
            recipientDeviceId: "dev-A",
            senderEphemeralPublicKey: "ephK",
            nonce: "n1",
            ciphertext: "ct1",
            keyVersion: 1
          }
        ]
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(ok.statusCode, 201);

    const list = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/key-envelopes?deviceId=dev-A`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(list.statusCode, 200);
    const envelopes = (list.json() as { envelopes: Array<{ ciphertext: string }> }).envelopes;
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0]?.ciphertext, "ct1");
  } finally {
    await app.close();
  }
});

test("chat: notification preferences round-trip with default 'all'", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-2"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-2");

    const def = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(def.statusCode, 200);
    assert.equal((def.json() as { preference: string }).preference, "all");

    const set = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "mentions" },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(set.statusCode, 200);

    const after = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal((after.json() as { preference: string }).preference, "mentions");
  } finally {
    await app.close();
  }
});

test("chat: push webhook respects per-user preferences", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-3"));
    const userBToken = app.jwt.sign(buildClaims("user-b"));
    const userCToken = app.jwt.sign(buildClaims("user-c"));
    const userDToken = app.jwt.sign(buildClaims("user-d"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-3");

    for (const [userId, userToken] of [
      ["user-b", userBToken],
      ["user-c", userCToken],
      ["user-d", userDToken]
    ] as const) {
      const invite = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/invites`,
        payload: { email: `${userId}@example.com`, role: "crew_member" },
        headers: { authorization: `Bearer ${athleteToken}` }
      });
      assert.equal(invite.statusCode, 201);
      const inviteToken = (invite.json() as { token: string }).token;
      const accept = await app.inject({
        method: "POST",
        url: `/race-rooms/${roomId}/invites/accept`,
        payload: { token: inviteToken },
        headers: { authorization: `Bearer ${userToken}` }
      });
      assert.equal(accept.statusCode, 200);
    }

    for (const [userToken, pref] of [
      [userBToken, "all"],
      [userCToken, "mentions"],
      [userDToken, "none"]
    ] as const) {
      const set = await app.inject({
        method: "POST",
        url: `/chat/rooms/${roomId}/notification-prefs`,
        payload: { preference: pref },
        headers: { authorization: `Bearer ${userToken}` }
      });
      assert.equal(set.statusCode, 200);
    }

    for (const [userId, userToken] of [
      ["user-b", userBToken],
      ["user-c", userCToken],
      ["user-d", userDToken]
    ] as const) {
      const reg = await app.inject({
        method: "POST",
        url: "/chat/push/tokens",
        payload: { deviceId: `dev-${userId}`, platform: "ios", token: `apns-${userId}` },
        headers: { authorization: `Bearer ${userToken}` }
      });
      assert.equal(reg.statusCode, 201);
    }

    const noMention = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        roomId,
        encryptedPreview: { ciphertext: "ct", nonce: "n", keyVersion: 1 }
      }
    });
    assert.equal(noMention.statusCode, 200);
    const noMentionResult = noMention.json() as {
      delivered: number;
      tokens: Array<{ userId: string }>;
    };
    const noMentionUsers = noMentionResult.tokens.map((t) => t.userId).sort();
    assert.deepEqual(noMentionUsers, ["user-b"]);

    const mention = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        mentionedUserIds: ["user-c"],
        roomId,
        encryptedPreview: { ciphertext: "ct", nonce: "n", keyVersion: 1 }
      }
    });
    assert.equal(mention.statusCode, 200);
    const mentionResult = mention.json() as { tokens: Array<{ userId: string }> };
    const mentionUsers = mentionResult.tokens.map((t) => t.userId).sort();
    assert.deepEqual(mentionUsers, ["user-b", "user-c"]);
  } finally {
    await app.close();
  }
});

test("chat: only race owner can purge chat data via DELETE", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-4"));
    const otherToken = app.jwt.sign(buildClaims("other-4"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-4");

    const denied = await app.inject({
      method: "DELETE",
      url: `/chat/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${otherToken}` }
    });
    assert.equal(denied.statusCode, 403);

    const ok = await app.inject({
      method: "DELETE",
      url: `/chat/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(ok.statusCode, 200);
    const result = ok.json() as { roomId: string };
    assert.equal(result.roomId, roomId);
  } finally {
    await app.close();
  }
});
