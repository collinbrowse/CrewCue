/**
 * Channel-level encrypt/decrypt and room-key bootstrap via @crewcue/chat-crypto.
 */
import type { ApiClient } from "../../api/client";
import {
  decodeRoomKey,
  decryptMessage,
  encodeRoomKey,
  encryptMessage,
  ensureRoomKeyReady,
  type EncryptedMessage,
  type RoomMemberIdentity
} from "@crewcue/chat-crypto";
import { chatSecureStorageAdapter } from "./secureStorageAdapter";

export type ChannelMember = RoomMemberIdentity;

function apiToChatCrypto(api: ApiClient) {
  return {
    registerIdentity: (publicKey: string) => api.registerChatIdentity({ publicKey }),
    fetchIdentity: (userId: string) => api.getChatUserIdentity(userId),
    uploadIdentityBackup: (upload: { ciphertext: string; nonce: string; version: number }) =>
      api.uploadChatIdentityBackup(upload),
    fetchIdentityBackup: () => api.getChatIdentityBackup(),
    listKeyEnvelopes: (roomId: string) => api.listChatKeyEnvelopes(roomId),
    uploadKeyEnvelopes: (roomId: string, envelopes: Parameters<ApiClient["uploadChatKeyEnvelopes"]>[1]) =>
      api.uploadChatKeyEnvelopes(roomId, envelopes)
  };
}

export async function bootstrapChannelKey(
  api: ApiClient,
  roomId: string,
  members: ChannelMember[]
): Promise<{ keyB64: string; keyVersion: number }> {
  let attempt = 0;
  for (;;) {
    const result = await ensureRoomKeyReady(chatSecureStorageAdapter, apiToChatCrypto(api), roomId, members, {
      retryAttempt: attempt
    });
    if (result.status === "ready" || result.status === "catastrophic_rekey") {
      return result.material;
    }
    attempt += 1;
    if (attempt > 3) {
      throw new Error("Syncing secure chat…");
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
}

export function encryptOutgoing(keyB64: string, body: string, keyVersion: number): EncryptedMessage {
  return encryptMessage(body, decodeRoomKey(keyB64), keyVersion);
}

export function decryptIncoming(keyB64: string, payload: EncryptedMessage): string | null {
  return decryptMessage(payload, decodeRoomKey(keyB64));
}

export { encodeRoomKey as encodeChannelKey, decodeRoomKey as decodeChannelKey };
