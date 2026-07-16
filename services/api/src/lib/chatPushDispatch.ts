/**
 * Pluggable chat push dispatch.
 *
 * Crew chat MVP sends plaintext preview text (or generic fallback copy) to
 * APNS/FCM. The actual send is done by an injected transport so we can:
 *   - in dev: log the dispatch and skip the network
 *   - in production: wire APNs HTTP/2 (with a .p8 signing key) and FCM HTTP v1
 *     (with a service-account access token)
 *   - in tests: capture dispatches deterministically
 */
import type {
  ChatPushPlatform,
  ChatPushTokenRecord,
  ChatPushWebhookPayload
} from "@crewcue/contracts";

export const GENERIC_CHAT_PUSH_BODY = "New Message in Crew Chat";

export type ChatPushDeliveryTarget = {
  platform: ChatPushPlatform;
  token: string;
  userId: string;
  deviceId: string;
};

export type ChatPushDispatchInput = {
  channelId: string;
  roomId: string;
  /** Optional short plaintext preview; falls back to GENERIC_CHAT_PUSH_BODY. */
  previewText?: ChatPushWebhookPayload["previewText"];
  targets: ChatPushDeliveryTarget[];
  /** Body to use when previewText is missing. */
  genericFallback?: string;
};

export type ChatPushDispatchResult = {
  delivered: number;
  attempts: number;
  failures: Array<{ deviceId: string; reason: string }>;
};

export type ChatPushTransport = (input: ChatPushDispatchInput) => Promise<ChatPushDispatchResult>;

let activeTransport: ChatPushTransport = loggingTransport;

export function setChatPushTransport(transport: ChatPushTransport): void {
  activeTransport = transport;
}

export function resetChatPushTransport(): void {
  activeTransport = loggingTransport;
}

export async function dispatchChatPush(input: ChatPushDispatchInput): Promise<ChatPushDispatchResult> {
  const enriched = {
    ...input,
    genericFallback: input.genericFallback ?? GENERIC_CHAT_PUSH_BODY
  };
  return activeTransport(enriched);
}

export function tokensToTargets(tokens: ChatPushTokenRecord[]): ChatPushDeliveryTarget[] {
  return tokens.map((t) => ({
    platform: t.platform,
    token: t.token,
    userId: t.userId,
    deviceId: t.deviceId
  }));
}

async function loggingTransport(input: ChatPushDispatchInput): Promise<ChatPushDispatchResult> {
  // Log dispatch metadata only — never log preview body text.
  // eslint-disable-next-line no-console
  console.log("chat_push_dispatch", {
    channelId: input.channelId,
    roomId: input.roomId,
    targetCount: input.targets.length,
    hasPreviewText: Boolean(input.previewText?.trim())
  });
  return {
    delivered: input.targets.length,
    attempts: input.targets.length,
    failures: []
  };
}
