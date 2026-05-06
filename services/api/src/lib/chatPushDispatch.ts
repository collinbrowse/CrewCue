/**
 * Pluggable chat push dispatch.
 *
 * Strict E2E means our server only forwards encrypted payloads. The actual
 * APNS/FCM send is done by an injected transport so we can:
 *   - in dev: log the dispatch and skip the network
 *   - in production: wire APNs HTTP/2 (with a .p8 signing key) and FCM HTTP v1
 *     (with a service-account access token)
 *   - in tests: capture dispatches deterministically
 *
 * The shape of the outbound payload is "data only": title/body fall back to
 * the generic copy on the device when the NSE/FCM service cannot decrypt.
 * Phase 6 (issue #230) covers the on-device decryption.
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
  encryptedPreview: ChatPushWebhookPayload["encryptedPreview"];
  targets: ChatPushDeliveryTarget[];
  /** Body to fall back to when the device cannot decrypt the preview. */
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
  // The server logs once per dispatch with no payload bodies — content is
  // ciphertext only — to confirm the path works during dev/staging soak.
  // eslint-disable-next-line no-console
  console.log("chat_push_dispatch", {
    channelId: input.channelId,
    roomId: input.roomId,
    targetCount: input.targets.length,
    keyVersion: input.encryptedPreview.keyVersion
  });
  return {
    delivered: input.targets.length,
    attempts: input.targets.length,
    failures: []
  };
}
