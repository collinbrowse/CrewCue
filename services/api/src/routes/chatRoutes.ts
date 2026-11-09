/**
 * Crew chat HTTP routes (ADR 0010): first-party messages with long-poll live updates,
 * photos in object storage, push devices, notification prefs, and direct APNs/FCM push.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CHAT_LONG_POLL_MAX_SECONDS,
  CHAT_MESSAGE_MAX_CHARS,
  CHAT_PHOTO_MAX_BYTES,
  type ChatMessage,
  type ChatMessagePage,
  type ChatNotificationPref,
  type ChatNotificationPrefRecord,
  type ChatPhotoUploadResponse,
  type ChatPushDeviceRecord,
  type ChatSendMessageResponse,
  type RaceRoom
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
  hasChatMessageBefore,
  initChatMessageStore,
  insertChatMessage,
  latestChatMessageSeq,
  listChatMessages,
  type StoredChatMessage
} from "../lib/chatMessageStore.js";
import {
  CHAT_PHOTO_CONTENT_TYPES,
  MemoryChatPhotoStore,
  chatPhotoKeyBelongsTo,
  chatPhotoStore,
  newChatPhotoKey
} from "../lib/chatPhotoStore.js";
import { publishChatRoom, subscribeChatRoom } from "../lib/chatLive.js";
import { chatPushBody, devicesToTargets, dispatchChatPush } from "../lib/chatPushDispatch.js";

const UNKNOWN_SENDER = "Crew member";
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

const notificationPrefSchema = z.object({
  preference: z.enum(["all", "mentions", "none"])
});

const pushDeviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  platform: z.enum(["ios", "android", "web"]),
  token: z.string().trim().min(1).max(4096),
  apnsEnvironment: z.enum(["development", "production"]).optional()
});

const cursorSchema = z.string().regex(/^\d{1,18}$/);

const listQuerySchema = z.object({
  after: cursorSchema.optional(),
  before: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
  wait: z.coerce.number().int().min(0).max(CHAT_LONG_POLL_MAX_SECONDS).optional()
});

const sendMessageSchema = z.object({
  clientMessageId: z.string().trim().min(1).max(200),
  text: z.string().max(CHAT_MESSAGE_MAX_CHARS).optional(),
  photoKey: z.string().trim().min(1).max(512).optional()
});

/** Sends 401/404/403 and returns undefined unless the caller is a member of the room. */
async function requireRoomMember(
  request: FastifyRequest,
  reply: FastifyReply,
  roomId: string
): Promise<RaceRoom | undefined> {
  if (!request.identity) {
    await reply.code(401).send({ error: "Unauthorized" });
    return undefined;
  }
  const room = await getRaceRoom(roomId);
  if (!room) {
    await reply.code(404).send({ error: "Race room not found" });
    return undefined;
  }
  if (!room.memberships.some((m) => m.userId === request.identity?.sub)) {
    await reply.code(403).send({ error: "Not a member of this room" });
    return undefined;
  }
  return room;
}

async function isMemberOfRoom(roomId: string, userId: string): Promise<boolean> {
  const room = await getRaceRoom(roomId);
  return room?.memberships.some((m) => m.userId === userId) ?? false;
}

function toWire(message: StoredChatMessage): ChatMessage {
  const store = chatPhotoStore();
  return {
    id: String(message.seq),
    roomId: message.roomId,
    senderUserId: message.senderUserId,
    clientMessageId: message.clientMessageId,
    text: message.text,
    ...(message.photoKey && store
      ? {
          photo: {
            url: store.url(message.photoKey),
            contentType: message.photoContentType ?? "image/jpeg",
            byteSize: message.photoByteSize ?? 0
          }
        }
      : {}),
    createdAt: message.createdAt
  };
}

function membersOf(room: RaceRoom): ChatMessagePage["members"] {
  return room.memberships.map((m) => ({
    userId: m.userId,
    ...(m.displayName?.trim() ? { displayName: m.displayName.trim() } : {})
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Members named as "@Name" in the text (case-insensitive, whole name). */
export function mentionedUserIds(room: RaceRoom, text: string): Set<string> {
  const out = new Set<string>();
  for (const member of room.memberships) {
    const name = member.displayName?.trim();
    if (!name) continue;
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|[\\s.,!?;:])`, "i");
    if (pattern.test(text)) out.add(member.userId);
  }
  return out;
}

const pendingPush = new Set<Promise<void>>();

/** Test-only: waits for push fan-out started by message sends. */
export async function _settleChatPushForTests(): Promise<void> {
  while (pendingPush.size) {
    await Promise.all(Array.from(pendingPush));
  }
}

async function fanOutChatPush(room: RaceRoom, message: StoredChatMessage, log: FastifyInstance["log"]): Promise<void> {
  const recipients = room.memberships.map((m) => m.userId).filter((id) => id !== message.senderUserId);
  if (recipients.length === 0) return;
  const prefs = await listChatNotificationPrefsForUsers(recipients, room.id);
  const mentioned = mentionedUserIds(room, message.text);
  const eligible = recipients.filter((userId) => {
    const pref: ChatNotificationPref = prefs.find((p) => p.userId === userId)?.preference ?? "all";
    if (pref === "none") return false;
    if (pref === "mentions") return mentioned.has(userId);
    return true;
  });
  if (eligible.length === 0) return;
  const devices = await listChatPushDevicesForUsers(eligible);
  if (devices.length === 0) return;
  const sender = room.memberships.find((m) => m.userId === message.senderUserId)?.displayName?.trim() || UNKNOWN_SENDER;
  const result = await dispatchChatPush({
    kind: "chat",
    roomId: room.id,
    messageId: String(message.seq),
    title: room.name?.trim() || "Crew chat",
    body: chatPushBody(sender, message.text, Boolean(message.photoKey)),
    targets: devicesToTargets(devices)
  });
  log.info(
    {
      chatPush: {
        roomId: room.id,
        delivered: result.delivered,
        attempts: result.attempts,
        failures: result.failures.length,
        pruned: result.invalidDeviceIds.length
      }
    },
    "chat_push_dispatched"
  );
}

function schedulePush(room: RaceRoom, message: StoredChatMessage, log: FastifyInstance["log"]): void {
  const run = fanOutChatPush(room, message, log)
    .catch((err) => log.warn({ err, roomId: room.id }, "chat_push_failed"))
    .finally(() => pendingPush.delete(run));
  pendingPush.add(run);
}

type WakeReason = "message" | "membership" | "timeout" | "closed";

/** Resolves on the first room event, the timeout, or the client hanging up. */
function waitForRoom(roomId: string, waitMs: number, request: FastifyRequest): {
  promise: Promise<WakeReason>;
  cancel: () => void;
} {
  let settle: (reason: WakeReason) => void = () => undefined;
  const promise = new Promise<WakeReason>((resolve) => {
    settle = resolve;
  });
  let done = false;
  const finish = (reason: WakeReason) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
    request.raw.off("close", onClose);
    settle(reason);
  };
  const onClose = () => finish("closed");
  const unsubscribe = subscribeChatRoom(roomId, (event) => finish(event));
  const timer = setTimeout(() => finish("timeout"), waitMs);
  request.raw.on("close", onClose);
  return { promise, cancel: () => finish("closed") };
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  await initChatPersistence(app.log);
  await initChatMessageStore(app.log);

  app.addContentTypeParser(
    [...CHAT_PHOTO_CONTENT_TYPES],
    { parseAs: "buffer", bodyLimit: CHAT_PHOTO_MAX_BYTES },
    (_request, body, done) => done(null, body)
  );

  app.get("/chat/rooms/:roomId/messages", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid chat query" });
    }
    let room = await requireRoomMember(request, reply, roomId);
    if (!room) return reply;
    const userId = request.identity!.sub;
    const { after, before, wait } = parsed.data;
    const limit = parsed.data.limit ?? DEFAULT_PAGE;
    if (after !== undefined && before !== undefined) {
      return reply.code(400).send({ error: "Use after or before, not both" });
    }

    let messages: StoredChatMessage[];
    if (after !== undefined) {
      // Subscribe before the first read so a message landing in between still wakes us.
      const waiter = wait ? waitForRoom(roomId, wait * 1000, request) : undefined;
      messages = await listChatMessages({ roomId, limit, after: Number(after) });
      if (messages.length || !waiter) {
        waiter?.cancel();
      } else {
        const reason = await waiter.promise;
        if (reason === "closed") return reply;
        const latest = await getRaceRoom(roomId);
        if (!latest || !latest.memberships.some((m) => m.userId === userId)) {
          return reply.code(403).send({ error: "Not a member of this room" });
        }
        room = latest;
        messages = await listChatMessages({ roomId, limit, after: Number(after) });
      }
    } else {
      messages = await listChatMessages({
        roomId,
        limit,
        ...(before !== undefined ? { before: Number(before) } : {})
      });
    }

    const oldest = messages[0];
    const newest = messages.at(-1);
    const olderCursor =
      after === undefined && oldest && (await hasChatMessageBefore(roomId, oldest.seq)) ? String(oldest.seq) : undefined;
    let latestCursor: string;
    if (after !== undefined) {
      latestCursor = newest ? String(newest.seq) : after;
    } else if (before === undefined) {
      latestCursor = newest ? String(newest.seq) : "";
    } else {
      const seq = await latestChatMessageSeq(roomId);
      latestCursor = seq === undefined ? "" : String(seq);
    }
    const page: ChatMessagePage = {
      messages: messages.map(toWire),
      members: membersOf(room),
      selfUserId: userId,
      latestCursor,
      ...(olderCursor ? { olderCursor } : {})
    };
    return reply.send(page);
  });

  app.post("/chat/rooms/:roomId/messages", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((i) => i.path[0] === "text" && i.code === "too_big");
      return reply
        .code(tooLong ? 413 : 400)
        .send({ error: tooLong ? `Messages are limited to ${CHAT_MESSAGE_MAX_CHARS} characters` : "Invalid chat message" });
    }
    const room = await requireRoomMember(request, reply, roomId);
    if (!room) return reply;
    const userId = request.identity!.sub;
    const text = (parsed.data.text ?? "").trim();
    const photoKey = parsed.data.photoKey;
    if (!text && !photoKey) {
      return reply.code(400).send({ error: "A message needs text or a photo" });
    }
    let photo: { contentType: string; byteSize: number } | undefined;
    if (photoKey) {
      const store = chatPhotoStore();
      if (!store) return reply.code(503).send({ error: "Chat photos are not configured on this deployment" });
      if (!chatPhotoKeyBelongsTo(photoKey, roomId, userId)) {
        return reply.code(400).send({ error: "Unknown photo" });
      }
      photo = await store.stat(photoKey);
      if (!photo) return reply.code(400).send({ error: "Unknown photo" });
    }
    const { message, duplicate } = await insertChatMessage({
      roomId,
      senderUserId: userId,
      clientMessageId: parsed.data.clientMessageId,
      text,
      ...(photoKey && photo
        ? { photoKey, photoContentType: photo.contentType, photoByteSize: photo.byteSize }
        : {})
    });
    if (!duplicate) {
      publishChatRoom(roomId, "message");
      schedulePush(room, message, app.log);
    }
    const response: ChatSendMessageResponse = { message: toWire(message), duplicate };
    return reply.code(duplicate ? 200 : 201).send(response);
  });

  app.post("/chat/rooms/:roomId/photos", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const room = await requireRoomMember(request, reply, roomId);
    if (!room) return reply;
    const contentType = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(CHAT_PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      return reply.code(415).send({ error: "Photos must be JPEG, PNG, HEIC or WebP" });
    }
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: "Empty photo" });
    }
    const store = chatPhotoStore();
    if (!store) return reply.code(503).send({ error: "Chat photos are not configured on this deployment" });
    const photoKey = newChatPhotoKey(roomId, request.identity!.sub, contentType);
    try {
      await store.put(photoKey, body, contentType);
    } catch (err) {
      request.log.error({ err, roomId }, "chat_photo_upload_failed");
      return reply.code(502).send({ error: "Couldn't store the photo" });
    }
    const response: ChatPhotoUploadResponse = { photoKey, contentType, byteSize: body.length };
    return reply.code(201).send(response);
  });

  // Local/dev photo reads (memory store only). Bucket photos use presigned URLs instead.
  app.get("/chat/photos/*", async (request, reply) => {
    const store = chatPhotoStore();
    if (!(store instanceof MemoryChatPhotoStore)) {
      return reply.code(404).send({ error: "Not found" });
    }
    const key = (request.params as { "*": string })["*"];
    const { exp, sig } = (request.query ?? {}) as { exp?: string; sig?: string };
    const photo = store.read(key, exp, sig);
    if (!photo) return reply.code(404).send({ error: "Not found" });
    return reply.header("content-type", photo.contentType).header("cache-control", "private, max-age=3600").send(photo.bytes);
  });

  const registerDevice = async (request: FastifyRequest, reply: FastifyReply) => {
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
      registeredAt: new Date().toISOString(),
      ...(parsed.data.platform === "ios" && parsed.data.apnsEnvironment
        ? { apnsEnvironment: parsed.data.apnsEnvironment }
        : {})
    };
    await upsertChatPushDevice(record);
    return reply.code(201).send(record);
  };

  app.post("/chat/devices", registerDevice);
  app.post("/chat/push/tokens", registerDevice);

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
    const room = await requireRoomMember(request, reply, (request.params as { roomId: string }).roomId);
    if (!room) return reply;
    const store = chatPhotoStore();
    return reply.send({
      memberCount: room.memberships.length,
      photoStorage: store?.kind ?? "unconfigured"
    });
  });
}
