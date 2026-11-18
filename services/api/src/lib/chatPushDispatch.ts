/**
 * Chat push dispatch (ADR 0011).
 *
 * The send goes through a pluggable transport:
 *   - production: APNs (token .p8) for iOS and FCM HTTP v1 for Android, from env
 *     (see chatPushTransports.ts and docs/runbooks/chat-push.md)
 *   - unconfigured platforms / dev: a logging transport that sends nothing
 *   - tests: a fake transport via setChatPushTransport
 */
import type { ChatPushDeviceRecord, ChatPushPlatform } from "@crewcue/contracts";
import {
  apnsTransport,
  fcmTransport,
  platformRoutingTransport,
  readApnsConfig,
  readFcmServiceAccount
} from "./chatPushTransports.js";
import { deleteChatPushDevices } from "./chatPersistence.js";

export const GENERIC_CHAT_PUSH_BODY = "New Message in Crew Chat";
export const CHAT_PUSH_PREVIEW_MAX_CHARS = 140;

export type ChatPushDeliveryTarget = {
  platform: ChatPushPlatform;
  token: string;
  userId: string;
  deviceId: string;
  apnsEnvironment?: "development" | "production";
};

export type ChatPushDispatchInput = {
  /**
   * Sent as the payload's `type`. "chat" opens the room's thread on tap; "schedule" opens the race;
   * "tracking" is the runner's start-tracking reminder (trackingReminderScheduler.ts).
   */
  kind?: "chat" | "schedule" | "tracking";
  roomId: string;
  messageId?: string;
  /**
   * When the push stops being true (epoch ms). Unset: the provider's default storage applies.
   * Set: APNs gets `apns-expiration` and FCM gets `android.ttl`, so a phone that was offline
   * never shows it late, and a provider request that would start at or after it is not made.
   */
  expiresAtMs?: number;
  /**
   * The key a newer push replaces an older one by (`apns-collapse-id`, FCM
   * `android.notification.tag`). Unset: APNs uses `messageId ?? roomId`, FCM uses `roomId`.
   * Not sent in the payload.
   */
  collapseKey?: string;
  /** Notification title (race name). */
  title: string;
  /** Notification body. Falls back to GENERIC_CHAT_PUSH_BODY. */
  body: string;
  targets: ChatPushDeliveryTarget[];
};

export type ChatPushDispatchResult = {
  delivered: number;
  attempts: number;
  failures: Array<{ deviceId: string; reason: string }>;
  /** Devices whose token the provider rejected for good. The caller deletes them. */
  invalidDeviceIds: string[];
};

export type ChatPushTransport = (input: ChatPushDispatchInput) => Promise<ChatPushDispatchResult>;

let activeTransport: ChatPushTransport | undefined;

/** Transport from env: APNs and/or FCM when configured, logging for the rest. */
export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): ChatPushTransport {
  const apns = readApnsConfig(env);
  const fcm = readFcmServiceAccount(env);
  if (!apns && !fcm) return loggingTransport;
  return platformRoutingTransport({
    ios: apns ? apnsTransport(apns) : undefined,
    android: fcm ? fcmTransport(fcm) : undefined,
    fallback: loggingTransport
  });
}

export function setChatPushTransport(transport: ChatPushTransport): void {
  activeTransport = transport;
}

export function resetChatPushTransport(): void {
  activeTransport = undefined;
}

export async function dispatchChatPush(input: ChatPushDispatchInput): Promise<ChatPushDispatchResult> {
  if (!activeTransport) activeTransport = transportFromEnv();
  if (input.targets.length === 0) {
    return { delivered: 0, attempts: 0, failures: [], invalidDeviceIds: [] };
  }
  const result = await activeTransport({
    ...input,
    kind: input.kind ?? "chat",
    body: input.body.trim() || GENERIC_CHAT_PUSH_BODY
  });
  if (result.invalidDeviceIds.length) {
    // Delete by the token that was rejected, not the device id alone: the device may have
    // re-registered a fresh token while this send was in flight.
    const invalid = new Set(result.invalidDeviceIds);
    await deleteChatPushDevices(
      input.targets
        .filter((t) => invalid.has(t.deviceId))
        .map((t) => ({ deviceId: t.deviceId, token: t.token }))
    );
  }
  return result;
}

export function devicesToTargets(devices: ChatPushDeviceRecord[]): ChatPushDeliveryTarget[] {
  return devices.map((d) => ({
    platform: d.platform,
    token: d.token,
    userId: d.userId,
    deviceId: d.deviceId,
    ...(d.apnsEnvironment ? { apnsEnvironment: d.apnsEnvironment } : {})
  }));
}

/** "Ada: on my way" trimmed to the preview limit; "Ada sent a photo" for photo-only messages. */
export function chatPushBody(senderName: string, text: string, hasPhoto: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return hasPhoto ? `${senderName} sent a photo` : GENERIC_CHAT_PUSH_BODY;
  const preview =
    clean.length > CHAT_PUSH_PREVIEW_MAX_CHARS ? `${clean.slice(0, CHAT_PUSH_PREVIEW_MAX_CHARS - 1)}…` : clean;
  return `${senderName}: ${preview}`;
}

async function loggingTransport(input: ChatPushDispatchInput): Promise<ChatPushDispatchResult> {
  // Metadata only — never log message text or tokens.
  // eslint-disable-next-line no-console
  console.log("chat_push_dispatch", {
    roomId: input.roomId,
    targetCount: input.targets.length,
    transport: "log"
  });
  return { delivered: 0, attempts: 0, failures: [], invalidDeviceIds: [] };
}
