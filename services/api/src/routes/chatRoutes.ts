/**
 * Chat HTTP routes — Stream token, channel sync, push devices, notification prefs.
 * Crew chat MVP uses plaintext Stream messages (no server-side E2E crypto).
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  ChatNotificationPref,
  ChatNotificationPrefRecord,
  ChatPushDeviceRecord,
  ChatPushWebhookPayload,
  ChatStreamTokenResponse
} from "@crewcue/contracts";
import { getRaceRoom } from "./raceRooms.js";
import {
  deleteChatRoomData,
  getChatNotificationPref,
  initChatPersistence,
  listChatNotificationPrefsForUsers,
  listChatPushDevicesForUsers,
  setChatNotificationPref,
  upsertChatPushDevice
} from "../lib/chatPersistence.js";
import {
  GENERIC_CHAT_PUSH_BODY,
  dispatchChatPush,
  tokensToTargets
} from "../lib/chatPushDispatch.js";
import { deriveStreamUserId, mintStreamUserToken, readStreamCredentials } from "../lib/streamChat.js";
import { syncRaceRoomStreamChannelMembers } from "../lib/streamChannelMembers.js";

const streamTokenBodySchema = z.object({
  roomId: z.string().trim().min(1).optional()
});

const notificationPrefSchema = z.object({
  preference: z.enum(["all", "mentions", "none"])
});

const pushDeviceSchema = z.object({
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
  previewText: z.string().trim().min(1).max(500).optional()
});

const PUSH_WEBHOOK_SECRET_HEADER = "x-crewcue-chat-push-secret";

function hasValidPushWebhookSecret(request: FastifyRequest): boolean {
  const expected = process.env.CHAT_PUSH_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const raw = request.headers[PUSH_WEBHOOK_SECRET_HEADER];
  const provided = Array.isArray(raw) ? raw[0] : raw;
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

async function isMemberOfRoom(roomId: string, userId: string): Promise<boolean> {
  const room = await getRaceRoom(roomId);
  if (!room) return false;
  return room.memberships.some((m) => m.userId === userId);
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
    const parsed = pushDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid push device payload" });
    }
    const record: ChatPushDeviceRecord = {
      deviceId: parsed.data.deviceId,
      userId: request.identity.sub,
      platform: parsed.data.platform,
      token: parsed.data.token,
      registeredAt: new Date().toISOString()
    };
    await upsertChatPushDevice(record);
    return reply.code(201).send(record);
  });

  app.post("/chat/push/tokens", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = pushDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid push token payload" });
    }
    const record: ChatPushDeviceRecord = {
      deviceId: parsed.data.deviceId,
      userId: request.identity.sub,
      platform: parsed.data.platform,
      token: parsed.data.token,
      registeredAt: new Date().toISOString()
    };
    await upsertChatPushDevice(record);
    return reply.code(201).send(record);
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

  app.post("/chat/push/webhook", async (request, reply) => {
    const parsed = pushWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid push webhook payload" });
    }
    const payload: ChatPushWebhookPayload = parsed.data;
    const authenticatedSender = request.identity?.sub === payload.senderUserId;
    if (!authenticatedSender && !hasValidPushWebhookSecret(request)) {
      return reply.code(request.identity ? 403 : 401).send({ error: "Unauthorized" });
    }
    const room = await getRaceRoom(payload.roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const memberIds = new Set(room.memberships.map((m) => m.userId));
    if (!memberIds.has(payload.senderUserId)) {
      return reply.code(403).send({ error: "Sender is not a member of this room" });
    }
    const invalidRecipient = payload.recipientUserIds.find((userId) => !memberIds.has(userId));
    if (invalidRecipient) {
      return reply.code(400).send({ error: "Push recipients must be room members" });
    }
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
    const tokens = await listChatPushDevicesForUsers(eligibleUserIds);
    const dispatch = await dispatchChatPush({
      channelId: payload.channelId,
      roomId: payload.roomId,
      previewText: payload.previewText,
      targets: tokensToTargets(tokens)
    });
    return reply.send({
      delivered: dispatch.delivered,
      attempts: dispatch.attempts,
      failures: dispatch.failures,
      genericFallbackBody: GENERIC_CHAT_PUSH_BODY,
      previewText: payload.previewText,
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
    return reply.send({
      memberCount: memberIds.length,
      streamConfigured: Boolean(readStreamCredentials())
    });
  });
}
