import type { RaceRoom } from "@crewcue/contracts";
import type { ApiClient } from "../../api/client";
import type { ChatCryptoApi } from "@crewcue/chat-crypto";
import { syncRoomKeysForRooms } from "@crewcue/chat-crypto";
import { chatSecureStorageAdapter } from "./secureStorageAdapter";

function apiToChatCrypto(api: ApiClient): ChatCryptoApi {
  return {
    registerIdentity: (publicKey) => api.registerChatIdentity({ publicKey }),
    fetchIdentity: (userId) => api.getChatUserIdentity(userId),
    uploadIdentityBackup: (upload) => api.uploadChatIdentityBackup(upload),
    fetchIdentityBackup: () => api.getChatIdentityBackup(),
    listKeyEnvelopes: (roomId) => api.listChatKeyEnvelopes(roomId),
    uploadKeyEnvelopes: (roomId, envelopes) => api.uploadChatKeyEnvelopes(roomId, envelopes)
  };
}

async function memberIdentities(api: ApiClient, room: RaceRoom) {
  const members = [];
  for (const m of room.memberships) {
    const identity = await api.getChatUserIdentity(m.userId);
    if (identity?.publicKey) {
      members.push({ userId: m.userId, publicKey: identity.publicKey });
    }
  }
  return members;
}

export async function syncAllRoomKeys(api: ApiClient, rooms: RaceRoom[]): Promise<void> {
  const payloads = [];
  for (const room of rooms) {
    const members = await memberIdentities(api, room);
    if (members.length > 0) {
      payloads.push({ roomId: room.id, members, roomMemberCount: room.memberships.length });
    }
  }
  if (payloads.length === 0) return;
  await syncRoomKeysForRooms(chatSecureStorageAdapter, apiToChatCrypto(api), payloads);
}

export async function ensureRoomKeyForRoom(api: ApiClient, room: RaceRoom) {
  const { ensureRoomKeyReady } = await import("@crewcue/chat-crypto");
  const members = await memberIdentities(api, room);
  return ensureRoomKeyReady(chatSecureStorageAdapter, apiToChatCrypto(api), room.id, members, {
    roomMemberCount: room.memberships.length
  });
}
