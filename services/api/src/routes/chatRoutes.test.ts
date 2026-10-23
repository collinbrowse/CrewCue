import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { _resetChatPersistenceForTests } from "../lib/chatPersistence.js";
import { deriveStreamUserId } from "../lib/streamChat.js";

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
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 42.0, longitude: -70.0 },
          { id: "cp1", latitude: 42.01, longitude: -70.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 42.0, longitude: -70.0 },
        { latitude: 42.01, longitude: -70.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(activate.statusCode, 200);
  return roomId;
}

async function inviteAndAcceptMember(
  app: ReturnType<typeof buildApp>,
  roomId: string,
  ownerToken: string,
  memberToken: string,
  email = "crew@example.com"
): Promise<void> {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email, role: "crew_member" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(invite.statusCode, 201);
  const inviteToken = (invite.json() as { token: string }).token;
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: inviteToken },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(accept.statusCode, 200);
}

test("chat: push device registration on /chat/devices", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign(buildClaims("user-push"));
    const ok = await app.inject({
      method: "POST",
      url: "/chat/devices",
      payload: { deviceId: "dev-1", platform: "ios", token: "apns-1" },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(ok.statusCode, 201);
    const body = ok.json() as { userId: string; deviceId: string };
    assert.equal(body.userId, "user-push");
    assert.equal(body.deviceId, "dev-1");
  } finally {
    await app.close();
  }
});

test("chat: only race owner can purge room chat data", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-retention"));
    const crewToken = app.jwt.sign(buildClaims("crew-retention"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-retention");
    await inviteAndAcceptMember(app, roomId, athleteToken, crewToken, "crew-retention@example.com");

    const athletePref = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "mentions" },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(athletePref.statusCode, 200);
    const crewPref = await app.inject({
      method: "POST",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      payload: { preference: "none" },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(crewPref.statusCode, 200);

    const memberDenied = await app.inject({
      method: "DELETE",
      url: `/chat/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(memberDenied.statusCode, 403);

    const purged = await app.inject({
      method: "DELETE",
      url: `/chat/rooms/${roomId}/messages`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(purged.statusCode, 200);
    const body = purged.json() as { prefsPurged: number; roomId: string };
    assert.equal(body.roomId, roomId);
    assert.equal(body.prefsPurged, 2);

    const defaultPref = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/notification-prefs`,
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(defaultPref.statusCode, 200);
    assert.equal((defaultPref.json() as { preference: string }).preference, "all");
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
    const token = app.jwt.sign(buildClaims("user-stream"));
    const res = await app.inject({
      method: "POST",
      url: "/chat/stream-token",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { token: string; streamUserId: string; streamApiKey: string };
    assert.ok(body.token.length > 10);
    assert.equal(body.streamUserId, deriveStreamUserId("user-stream"));
    assert.equal(body.streamApiKey, "test-key");
  } finally {
    delete process.env.STREAM_API_KEY;
    delete process.env.STREAM_API_SECRET;
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

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        roomId,
        previewText: "Hello crew"
      }
    });
    assert.equal(unauthenticated.statusCode, 401);

    const noMention = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        roomId,
        previewText: "Hello crew"
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(noMention.statusCode, 200);
    const noMentionResult = noMention.json() as {
      delivered: number;
      attempts: number;
      previewText?: string;
      genericFallbackBody: string;
    };
    assert.equal(noMentionResult.attempts, 1);
    assert.equal("tokens" in noMentionResult, false);
    assert.equal(noMentionResult.previewText, "Hello crew");

    const withMention = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["athlete-3", "user-b", "user-c", "user-d"],
        roomId,
        mentionedUserIds: ["user-c"]
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(withMention.statusCode, 200);
    const mentionResult = withMention.json() as { attempts: number; previewText?: string };
    assert.equal(mentionResult.attempts, 2);
    assert.equal(mentionResult.previewText, undefined);

    const nonMemberRecipient = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-3",
        recipientUserIds: ["outsider-push"],
        roomId,
        previewText: "Hello crew"
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(nonMemberRecipient.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("chat: push webhook rejects authenticated callers forging a different sender", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-forged-sender"));
    const crewToken = app.jwt.sign(buildClaims("crew-forged-sender"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-forged-sender");
    await inviteAndAcceptMember(
      app,
      roomId,
      athleteToken,
      crewToken,
      "crew-forged-sender@example.com"
    );

    const forged = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "crew-forged-sender",
        recipientUserIds: ["athlete-forged-sender"],
        roomId,
        previewText: "Forged dispatch"
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(forged.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("chat: push webhook accepts valid server secret and keeps member checks", async () => {
  _resetChatPersistenceForTests();
  process.env.CHAT_PUSH_WEBHOOK_SECRET = "server-fanout-secret";
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-server-fanout"));
    const crewToken = app.jwt.sign(buildClaims("crew-server-fanout"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-server-fanout");
    await inviteAndAcceptMember(
      app,
      roomId,
      athleteToken,
      crewToken,
      "crew-server-fanout@example.com"
    );

    const reg = await app.inject({
      method: "POST",
      url: "/chat/push/tokens",
      payload: { deviceId: "dev-crew-server", platform: "ios", token: "apns-crew-server" },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(reg.statusCode, 201);

    const wrongSecret = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-server-fanout",
        recipientUserIds: ["crew-server-fanout"],
        roomId,
        previewText: "Server fanout"
      },
      headers: { "x-crewcue-chat-push-secret": "wrong-secret" }
    });
    assert.equal(wrongSecret.statusCode, 401);

    const nonMemberSender = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "outsider-server-fanout",
        recipientUserIds: ["crew-server-fanout"],
        roomId,
        previewText: "Server fanout"
      },
      headers: { "x-crewcue-chat-push-secret": "server-fanout-secret" }
    });
    assert.equal(nonMemberSender.statusCode, 403);

    const ok = await app.inject({
      method: "POST",
      url: "/chat/push/webhook",
      payload: {
        channelId: `crew-${roomId}`,
        senderUserId: "athlete-server-fanout",
        recipientUserIds: ["crew-server-fanout"],
        roomId,
        previewText: "Server fanout"
      },
      headers: { "x-crewcue-chat-push-secret": "server-fanout-secret" }
    });
    assert.equal(ok.statusCode, 200);
    const body = ok.json() as { attempts: number; previewText?: string };
    assert.equal(body.attempts, 1);
    assert.equal(body.previewText, "Server fanout");
    assert.equal("tokens" in body, false);
  } finally {
    delete process.env.CHAT_PUSH_WEBHOOK_SECRET;
    await app.close();
  }
});

test("chat: diagnostics reports memberCount and streamConfigured only", async () => {
  _resetChatPersistenceForTests();
  const app = buildApp();
  await app.ready();
  try {
    const athleteToken = app.jwt.sign(buildClaims("athlete-diag"));
    const roomId = await createActivatedRoom(app, athleteToken, "athlete-diag");
    const res = await app.inject({
      method: "GET",
      url: `/chat/rooms/${roomId}/diagnostics`,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body.memberCount, 1);
    assert.equal(typeof body.streamConfigured, "boolean");
    assert.equal("identityCount" in body, false);
  } finally {
    await app.close();
  }
});
