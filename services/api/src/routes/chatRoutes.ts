/**
 * Chat HTTP routes.
 *
 * Surface:
 *   POST   /chat/stream-token  (optional JSON `{ "roomId": "<race-room-id>" }` syncs Stream members first)
 *   POST   /chat/rooms/:roomId/sync-stream-channel
 *   POST   /chat/devices
 *   GET    /chat/rooms/:roomId/key-envelopes
 *   POST   /chat/rooms/:roomId/key-envelopes
 *   GET    /chat/rooms/:roomId/notification-prefs
 *   POST   /chat/rooms/:roomId/notification-prefs
 *   POST   /chat/push/tokens
 *   POST   /chat/push/webhook
 *   DELETE /chat/rooms/:roomId/messages
 *
 * Server stores opaque ciphertext + metadata; it cannot read message content.
 * Membership authorization reuses race-room membership: only members of the
 * referenced `roomId` may register/list envelopes or read/write prefs.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ChatDeviceKey,
  ChatKeyEnvelope,
  ChatNotificationPref,
  ChatNotificationPrefRecord,
  ChatPushPlatform,
  ChatPushTokenRecord,
  ChatPushWebhookPayload,
  ChatStreamTokenResponse
} from "@crewcue/contracts";
import { getRaceRoom } from "./raceRooms.js";
import {
  deleteChatRoomData,
  getLatestChatKeyVersionForRoom,
  getChatNotificationPref,
  initChatPersistence,
  listChatDeviceKeysForUser,
  listChatDeviceKeysForUsers,
  listChatKeyEnvelopesForDevice,
  listChatNotificationPrefsForUsers,
  listChatPushTokensForUsers,
  setChatNotificationPref,
  upsertChatDeviceKey,
  upsertChatKeyEnvelope,
  upsertChatPushToken
} from "../lib/chatPersistence.js";
import {
  GENERIC_CHAT_PUSH_BODY,
  dispatchChatPush,
  tokensToTargets
} from "../lib/chatPushDispatch.js";
import { deriveStreamUserId, mintStreamUserToken, readStreamCredentials } from "../lib/streamChat.js";
import { syncRaceRoomStreamChannelMembers } from "../lib/streamChannelMembers.js";

const streamTokenBodySchema = z.object({
  /** When set, server syncs Stream channel members for this race room before minting the JWT. */
  roomId: z.string().trim().min(1).optional()
});

const deviceRegistrationSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  publicKey: z.string().trim().min(1).max(2048)
});

const envelopeUploadSchema = z.object({
  envelopes: z
    .array(
      z.object({
        recipientUserId: z.string().trim().min(1),
        recipientDeviceId: z.string().trim().min(1),
        senderEphemeralPublicKey: z.string().trim().min(1).max(2048),
        nonce: z.string().trim().min(1).max(2048),
        ciphertext: z.string().trim().min(1).max(8192),
        keyVersion: z.number().int().nonnegative()
      })
    )
    .min(1)
    .max(500)
});

const notificationPrefSchema = z.object({
  preference: z.enum(["all", "mentions", "none"])
});

const pushTokenSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  platform: z.enum(["ios", "android", "web"]),
  token: z.string().trim().min(1).max(2048)
});

const pushWebhookSchema = z.object({
  channelId: z.string().trim().min(1),
  senderUserId: z.string().trim().min(1),
  recipientUserIds: z.array(z.string().trim().min(1)),
  roomId: z.string().trim().min(1),
  mentionedUserIds: z.array(z.string().trim().min(1)).optional(),
  encryptedPreview: z.object({
    ciphertext: z.string().trim().min(1),
    nonce: z.string().trim().min(1),
    keyVersion: z.number().int().nonnegative()
  })
});

async function isMemberOfRoom(roomId: string, userId: string): Promise<boolean> {
  const room = await getRaceRoom(roomId);
  if (!room) return false;
  return room.memberships.some((m) => m.userId === userId);
}

function deviceQuerySchema() {
  return z.object({ deviceId: z.string().trim().min(1).max(200) });
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  await initChatPersistence(app.log);

  app.post("/chat/stream-token", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const creds = readStreamCredentials();
    if (!creds) {
      return reply.code(503).send({ error: "Stream Chat is not configured on this deployment" });
    }

    const bodyParse = streamTokenBodySchema.safeParse(request.body ?? {});
    if (bodyParse.success && bodyParse.data.roomId) {
      const room = await getRaceRoom(bodyParse.data.roomId);
      if (room?.memberships.some((m) => m.userId === identity.sub)) {
        try {
          await syncRaceRoomStreamChannelMembers(room, app.log);
        } catch (err) {
          app.log.error({ err, roomId: bodyParse.data.roomId }, "stream-token room sync failed");
          return reply
            .code(502)
            .send({ error: "Failed to prepare Stream Chat channel for this room" });
        }
      }
    }

    const streamUserId = deriveStreamUserId(identity.sub);
    const token = mintStreamUserToken(streamUserId, creds.apiSecret, {
      expiresInSeconds: 60 * 60
    });
    const response: ChatStreamTokenResponse = {
      token,
      streamUserId,
      streamApiKey: creds.apiKey
    };
    return reply.send(response);
  });

  app.post("/chat/rooms/:roomId/sync-stream-channel", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (!readStreamCredentials()) {
      return reply.code(503).send({ error: "Stream Chat is not configured on this deployment" });
    }
    const { roomId } = request.params as { roomId: string };
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (!room.memberships.some((m) => m.userId === identity.sub)) {
      return reply.code(403).send({ error: "Not a member of this room" });
    }
    try {
      await syncRaceRoomStreamChannelMembers(room, app.log);
    } catch (err) {
      app.log.error({ err, roomId }, "sync-stream-channel failed");
      return reply.code(502).send({ error: "Failed to sync Stream Chat channel members" });
    }
    return reply.send({ ok: true as const });
  });

  app.post("/chat/devices", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = deviceRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid device registration payload" });
    }
    const record: ChatDeviceKey = {
      deviceId: parsed.data.deviceId,
      userId: request.identity.sub,
      publicKey: parsed.data.publicKey,
      registeredAt: new Date().toISOString()
    };
    await upsertChatDeviceKey(record);
    return reply.code(201).send(record);
  });

  app.get("/chat/users/:userId/devices", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { userId } = request.params as { userId: string };
    if (!userId) {
      return reply.code(400).send({ error: "userId is required" });
    }
    const devices = await listChatDeviceKeysForUser(userId);
    return reply.send({ devices });
  });

  app.post("/chat/rooms/:roomId/key-envelopes", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { roomId } = request.params as { roomId: string };
    if (!(await isMemberOfRoom(roomId, request.identity.sub))) {
      return reply.code(403).send({ error: "Not a member of this room" });
    }
    const parsed = envelopeUploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid envelope payload" });
    }
    const now = new Date().toISOString();
    const stored: ChatKeyEnvelope[] = [];
    for (const e of parsed.data.envelopes) {
      const envelope: ChatKeyEnvelope = {
        roomId,
        recipientUserId: e.recipientUserId,
        recipientDeviceId: e.recipientDeviceId,
        senderEphemeralPublicKey: e.senderEphemeralPublicKey,
        nonce: e.nonce,
        ciphertext: e.ciphertext,
        keyVersion: e.keyVersion,
        createdAt: now
      };
      await upsertChatKeyEnvelope(envelope);
      stored.push(envelope);
    }
    return reply.code(201).send({ stored: stored.length, envelopes: stored });
  });

  app.get("/chat/rooms/:roomId/key-envelopes", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { roomId } = request.params as { roomId: string };
    if (!(await isMemberOfRoom(roomId, request.identity.sub))) {
      return reply.code(403).send({ error: "Not a member of this room" });
    }
    const queryParsed = deviceQuerySchema().safeParse(request.query ?? {});
    if (!queryParsed.success) {
      return reply.code(400).send({ error: "deviceId query is required" });
    }
    const envelopes = await listChatKeyEnvelopesForDevice(roomId, queryParsed.data.deviceId);
    const latestRoomKeyVersion = await getLatestChatKeyVersionForRoom(roomId);
    return reply.send({ envelopes, latestRoomKeyVersion });
  });

  app.get("/chat/rooms/:roomId/notification-prefs", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { roomId } = request.params as { roomId: string };
    if (!(await isMemberOfRoom(roomId, request.identity.sub))) {
      return reply.code(403).send({ error: "Not a member of this room" });
    }
    const pref = await getChatNotificationPref(request.identity.sub, roomId);
    return reply.send({
      preference: pref?.preference ?? "all",
      updatedAt: pref?.updatedAt
    });
  });

  app.post("/chat/rooms/:roomId/notification-prefs", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { roomId } = request.params as { roomId: string };
    if (!(await isMemberOfRoom(roomId, request.identity.sub))) {
      return reply.code(403).send({ error: "Not a member of this room" });
    }
    const parsed = notificationPrefSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid notification preference" });
    }
    const record: ChatNotificationPrefRecord = {
      userId: request.identity.sub,
      roomId,
      preference: parsed.data.preference,
      updatedAt: new Date().toISOString()
    };
    await setChatNotificationPref(record);
    return reply.send(record);
  });

  app.post("/chat/push/tokens", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = pushTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid push token payload" });
    }
    const record: ChatPushTokenRecord = {
      deviceId: parsed.data.deviceId,
      userId: request.identity.sub,
      platform: parsed.data.platform,
      token: parsed.data.token,
      registeredAt: new Date().toISOString()
    };
    await upsertChatPushToken(record);
    return reply.code(201).send(record);
  });

  /**
   * Stream Chat invokes this webhook with each new message. We never decrypt
   * the body — Stream sees ciphertext and so do we. The server uses recipient
   * notification prefs to fan out APNS/FCM. The actual outbound APNS/FCM
   * delivery is performed by `dispatchEncryptedPush` (provider-specific) and
   * is mocked in tests.
   */
  app.post("/chat/push/webhook", async (request, reply) => {
    const parsed = pushWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid push webhook payload" });
    }
    const payload: ChatPushWebhookPayload = parsed.data;
    const recipientsExceptSender = payload.recipientUserIds.filter(
      (id) => id !== payload.senderUserId
    );
    const prefs = await listChatNotificationPrefsForUsers(recipientsExceptSender, payload.roomId);
    const mentioned = new Set(payload.mentionedUserIds ?? []);
    const eligibleUserIds = recipientsExceptSender.filter((userId) => {
      const explicit = prefs.find((p) => p.userId === userId);
      const pref: ChatNotificationPref = explicit?.preference ?? "all";
      if (pref === "none") return false;
      if (pref === "mentions") return mentioned.has(userId);
      return true;
    });
    const tokens = await listChatPushTokensForUsers(eligibleUserIds);
    const dispatch = await dispatchChatPush({
      channelId: payload.channelId,
      roomId: payload.roomId,
      encryptedPreview: payload.encryptedPreview,
      targets: tokensToTargets(tokens)
    });
    return reply.send({
      delivered: dispatch.delivered,
      attempts: dispatch.attempts,
      failures: dispatch.failures,
      tokens: tokens.map((t) => ({
        userId: t.userId,
        deviceId: t.deviceId,
        platform: t.platform as ChatPushPlatform
      })),
      genericFallbackBody: GENERIC_CHAT_PUSH_BODY,
      encryptedPreview: payload.encryptedPreview,
      channelId: payload.channelId
    });
  });

  app.delete("/chat/rooms/:roomId/messages", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { roomId } = request.params as { roomId: string };
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (room.athleteId !== request.identity.sub) {
      return reply.code(403).send({ error: "Only the race owner can delete chat data" });
    }
    const result = await deleteChatRoomData(roomId);
    return reply.send(result);
  });

  // Helper for tests/cron to look up the Stream channel for a room without
  // going through the SDK.
  app.get("/chat/rooms/:roomId/diagnostics", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { roomId } = request.params as { roomId: string };
    if (!(await isMemberOfRoom(roomId, request.identity.sub))) {
      return reply.code(403).send({ error: "Not a member of this room" });
    }
    const room = await getRaceRoom(roomId);
    const memberIds = room?.memberships.map((m) => m.userId) ?? [];
    const devices = await listChatDeviceKeysForUsers(memberIds);
    return reply.send({
      memberCount: memberIds.length,
      deviceCount: devices.length,
      streamConfigured: Boolean(readStreamCredentials())
    });
  });
}
