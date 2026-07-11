import type { ChatKeyEnvelope, ChatKeyEnvelopeUpload, ChatUserIdentity } from "@crewcue/contracts";
import {
  decodeRoomKey,
  encodeRoomKey,
  generateRoomKey,
  unwrapRoomKey,
  wrapRoomKeyForUser
} from "./crypto.js";
import {
  decryptBackupFromServer,
  ensureBackupLocalSecret,
  ensureIdentity,
  encryptBackupForUpload,
  loadAllLocalRoomKeys,
  loadBackupLocalSecret,
  loadIdentity,
  loadLocalRoomKey,
  restoreIdentityFromBackupPayload,
  saveLocalRoomKey
} from "./identity.js";
import type {
  ChatCryptoStorageAdapter,
  IdentityKeyPair,
  RoomKeyMaterial,
  RoomMemberIdentity,
  WrappedRoomKey
} from "./types.js";

export type ChatCryptoApi = {
  registerIdentity(publicKey: string): Promise<ChatUserIdentity>;
  fetchIdentity(userId: string): Promise<ChatUserIdentity | undefined>;
  uploadIdentityBackup(upload: { ciphertext: string; nonce: string; version: number }): Promise<unknown>;
  fetchIdentityBackup(): Promise<{ ciphertext: string; nonce: string; version: number } | undefined>;
  listKeyEnvelopes(roomId: string): Promise<{ envelopes: ChatKeyEnvelope[]; latestRoomKeyVersion?: number }>;
  uploadKeyEnvelopes(roomId: string, envelopes: ChatKeyEnvelopeUpload[]): Promise<unknown>;
};

const MAX_DISTRIBUTE_RETRIES = 3;

function isDeterministicDistributor(identity: IdentityKeyPair, members: RoomMemberIdentity[]): boolean {
  const self = members.find((member) => member.publicKey === identity.publicKeyB64);
  if (!self) return false;
  const firstMember = [...members].sort((a, b) => a.userId.localeCompare(b.userId))[0];
  return firstMember?.userId === self.userId;
}

export async function restoreIdentityWithBackup(
  storage: ChatCryptoStorageAdapter,
  api: ChatCryptoApi
): Promise<IdentityKeyPair> {
  const backup = await api.fetchIdentityBackup();
  if (!backup) {
    const identity = await ensureIdentity(storage);
    await api.registerIdentity(identity.publicKeyB64);
    return identity;
  }
  const localSecret = await loadBackupLocalSecret(storage);
  if (!localSecret) {
    throw new Error("Unable to decrypt chat identity backup");
  }
  const payload = decryptBackupFromServer(backup, localSecret);
  if (!payload) {
    throw new Error("Unable to decrypt chat identity backup");
  }
  const existing = await loadIdentity(storage);
  if (existing?.secretKeyB64 === payload.identitySecretB64) {
    await api.registerIdentity(existing.publicKeyB64);
    return existing;
  }
  const restored = await restoreIdentityFromBackupPayload(storage, payload);
  await api.registerIdentity(restored.publicKeyB64);
  return restored;
}

export async function uploadKeyEnvelopesForMembers(
  api: ChatCryptoApi,
  roomId: string,
  members: RoomMemberIdentity[],
  keyB64: string,
  keyVersion: number
): Promise<void> {
  const keyBytes = decodeRoomKey(keyB64);
  const envelopes: ChatKeyEnvelopeUpload[] = [];
  for (const member of members) {
    const wrapped = wrapRoomKeyForUser(keyBytes, member.publicKey, keyVersion);
    envelopes.push({
      recipientUserId: member.userId,
      senderEphemeralPublicKey: wrapped.senderEphemeralPublicKeyB64,
      nonce: wrapped.nonceB64,
      ciphertext: wrapped.ciphertextB64,
      keyVersion
    });
  }
  if (envelopes.length > 0) {
    await api.uploadKeyEnvelopes(roomId, envelopes);
  }
}

async function tryUnwrapServerEnvelope(
  storage: ChatCryptoStorageAdapter,
  identity: IdentityKeyPair,
  roomId: string,
  envelope: ChatKeyEnvelope
): Promise<RoomKeyMaterial | undefined> {
  const wrapped: WrappedRoomKey = {
    ciphertextB64: envelope.ciphertext,
    nonceB64: envelope.nonce,
    senderEphemeralPublicKeyB64: envelope.senderEphemeralPublicKey,
    keyVersion: envelope.keyVersion
  };
  const unwrapped = unwrapRoomKey(wrapped, identity.secretKeyB64);
  if (!unwrapped) return undefined;
  const keyB64 = encodeRoomKey(unwrapped);
  await saveLocalRoomKey(storage, roomId, keyB64, envelope.keyVersion);
  return { keyB64, keyVersion: envelope.keyVersion };
}

export type EnsureRoomKeyResult =
  | { status: "ready"; material: RoomKeyMaterial }
  | { status: "syncing" }
  | { status: "catastrophic_rekey"; material: RoomKeyMaterial };

/**
 * Bootstrap or restore the per-room symmetric key for the caller.
 * Never throws "missing room key" — returns syncing or performs solo rekey.
 */
export async function ensureRoomKeyReady(
  storage: ChatCryptoStorageAdapter,
  api: ChatCryptoApi,
  roomId: string,
  members: RoomMemberIdentity[],
  options?: { retryAttempt?: number }
): Promise<EnsureRoomKeyResult> {
  const identity = await restoreIdentityWithBackup(storage, api);
  const fromServer = await api.listKeyEnvelopes(roomId);
  const latestVersion = fromServer.latestRoomKeyVersion ?? 0;
  const cached = await loadLocalRoomKey(storage, roomId);
  if (cached && cached.keyVersion >= latestVersion) {
    await uploadKeyEnvelopesForMembers(api, roomId, members, cached.keyB64, cached.keyVersion);
    await pushBackupSnapshot(storage, api, identity, roomId, cached);
    return { status: "ready", material: cached };
  }

  const envelopeToTry =
    fromServer.envelopes.length > 0
      ? fromServer.envelopes.reduce((acc, e) => (e.keyVersion > acc.keyVersion ? e : acc))
      : undefined;
  if (envelopeToTry) {
    const material = await tryUnwrapServerEnvelope(storage, identity, roomId, envelopeToTry);
    if (material) {
      await uploadKeyEnvelopesForMembers(api, roomId, members, material.keyB64, material.keyVersion);
      await pushBackupSnapshot(storage, api, identity, roomId, material);
      return { status: "ready", material };
    }
  }

  if (
    cached &&
    latestVersion > cached.keyVersion &&
    fromServer.envelopes.length === 0 &&
    isDeterministicDistributor(identity, members)
  ) {
    const newKey = generateRoomKey();
    const keyB64 = encodeRoomKey(newKey);
    await uploadKeyEnvelopesForMembers(api, roomId, members, keyB64, latestVersion);
    await saveLocalRoomKey(storage, roomId, keyB64, latestVersion);
    await pushBackupSnapshot(storage, api, identity, roomId, { keyB64, keyVersion: latestVersion });
    return { status: "ready", material: { keyB64, keyVersion: latestVersion } };
  }

  if (latestVersion === 0) {
    const newKey = generateRoomKey();
    const keyVersion = 1;
    const keyB64 = encodeRoomKey(newKey);
    await uploadKeyEnvelopesForMembers(api, roomId, members, keyB64, keyVersion);
    await saveLocalRoomKey(storage, roomId, keyB64, keyVersion);
    await pushBackupSnapshot(storage, api, identity, roomId, { keyB64, keyVersion });
    return { status: "ready", material: { keyB64, keyVersion } };
  }

  const attempt = options?.retryAttempt ?? 0;
  if (attempt < MAX_DISTRIBUTE_RETRIES) {
    return { status: "syncing" };
  }

  if (members.length === 1 && members[0]?.userId) {
    const nextVersion = latestVersion + 1;
    const newKey = generateRoomKey();
    const keyB64 = encodeRoomKey(newKey);
    await uploadKeyEnvelopesForMembers(api, roomId, members, keyB64, nextVersion);
    await saveLocalRoomKey(storage, roomId, keyB64, nextVersion);
    await pushBackupSnapshot(storage, api, identity, roomId, { keyB64, keyVersion: nextVersion });
    return { status: "catastrophic_rekey", material: { keyB64, keyVersion: nextVersion } };
  }

  return { status: "syncing" };
}

async function pushBackupSnapshot(
  storage: ChatCryptoStorageAdapter,
  api: ChatCryptoApi,
  identity: IdentityKeyPair,
  roomId: string,
  material: RoomKeyMaterial
): Promise<void> {
  const allRooms: Record<string, RoomKeyMaterial> = {};
  const backup = await api.fetchIdentityBackup();
  if (backup) {
    const localSecret = await ensureBackupLocalSecret(storage);
    const payload = decryptBackupFromServer(backup, localSecret);
    if (payload) {
      Object.assign(allRooms, payload.roomKeys);
    }
  }
  Object.assign(allRooms, await loadAllLocalRoomKeys(storage, [roomId]));
  allRooms[roomId] = material;
  const upload = await encryptBackupForUpload(storage, identity, allRooms, 1);
  await api.uploadIdentityBackup(upload);
}

export async function syncRoomKeysForRooms(
  storage: ChatCryptoStorageAdapter,
  api: ChatCryptoApi,
  rooms: Array<{ roomId: string; members: RoomMemberIdentity[] }>
): Promise<void> {
  for (const room of rooms) {
    let attempt = 0;
    for (;;) {
      const result = await ensureRoomKeyReady(storage, api, room.roomId, room.members, {
        retryAttempt: attempt
      });
      if (result.status === "ready" || result.status === "catastrophic_rekey") {
        break;
      }
      attempt += 1;
      if (attempt > MAX_DISTRIBUTE_RETRIES) {
        break;
      }
    }
  }
}
