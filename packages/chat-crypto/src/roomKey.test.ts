import test from "node:test";
import assert from "node:assert/strict";
import type { ChatBackupPayloadV1, ChatKeyEnvelope, ChatUserIdentity } from "@crewcue/contracts";
import {
  decodeRoomKey,
  encodeRoomKey,
  encryptBackupSecret,
  encryptMessage,
  generateBackupSecret,
  generateIdentityKeyPair,
  generateRoomKey,
  wrapRoomKeyForUser
} from "./crypto.js";
import {
  decryptBackupFromServer,
  ensureBackupLocalSecret,
  ensureIdentity,
  loadLocalRoomKey,
  saveLocalRoomKey
} from "./identity.js";
import type { ChatCryptoStorageAdapter } from "./types.js";
import { ensureRoomKeyReady, restoreIdentityWithBackup, type ChatCryptoApi } from "./roomKey.js";

function memoryStorage(): ChatCryptoStorageAdapter & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    deleteItem: async (key) => {
      map.delete(key);
    }
  };
}

function mockApi(state: {
  identities: Map<string, ChatUserIdentity>;
  envelopes: Map<string, ChatKeyEnvelope[]>;
  latestVersion: Map<string, number>;
  backup?: { ciphertext: string; nonce: string; version: number };
}): ChatCryptoApi {
  return {
    registerIdentity: async (publicKey) => {
      const record = { userId: "self", publicKey, registeredAt: new Date().toISOString() };
      state.identities.set("self", record);
      return record;
    },
    fetchIdentity: async (userId) => state.identities.get(userId),
    uploadIdentityBackup: async (upload) => {
      state.backup = upload;
    },
    fetchIdentityBackup: async () => state.backup,
    listKeyEnvelopes: async (roomId) => ({
      envelopes: state.envelopes.get(roomId) ?? [],
      latestRoomKeyVersion: state.latestVersion.get(roomId)
    }),
    uploadKeyEnvelopes: async (roomId, uploads) => {
      const list = state.envelopes.get(roomId) ?? [];
      const now = new Date().toISOString();
      for (const u of uploads) {
        list.push({
          roomId,
          recipientUserId: u.recipientUserId,
          senderEphemeralPublicKey: u.senderEphemeralPublicKey,
          nonce: u.nonce,
          ciphertext: u.ciphertext,
          keyVersion: u.keyVersion,
          createdAt: now
        });
        state.latestVersion.set(roomId, Math.max(state.latestVersion.get(roomId) ?? 0, u.keyVersion));
      }
      state.envelopes.set(roomId, list);
    }
  };
}

test("roomKey: bootstrap new room creates version 1 envelopes", async () => {
  const storage = memoryStorage();
  const alice = generateIdentityKeyPair();
  const state = {
    identities: new Map([["alice", { userId: "alice", publicKey: alice.publicKeyB64, registeredAt: "" }]]),
    envelopes: new Map<string, ChatKeyEnvelope[]>(),
    latestVersion: new Map<string, number>()
  };
  const api = mockApi(state);
  await ensureIdentity(storage);
  const result = await ensureRoomKeyReady(storage, api, "room-1", [
    { userId: "alice", publicKey: alice.publicKeyB64 }
  ]);
  assert.equal(result.status, "ready");
  const envs = state.envelopes.get("room-1") ?? [];
  assert.equal(envs.length, 1);
  assert.equal(envs[0]?.keyVersion, 1);
});

test("roomKey: join member unwraps existing envelope", async () => {
  const storage = memoryStorage();
  const alice = generateIdentityKeyPair();
  const bob = generateIdentityKeyPair();
  const roomKey = generateRoomKey();
  const wrapped = wrapRoomKeyForUser(roomKey, bob.publicKeyB64, 1);
  const state = {
    identities: new Map([
      ["alice", { userId: "alice", publicKey: alice.publicKeyB64, registeredAt: "" }],
      ["bob", { userId: "bob", publicKey: bob.publicKeyB64, registeredAt: "" }]
    ]),
    envelopes: new Map<string, ChatKeyEnvelope[]>([
      [
        "room-1",
        [
          {
            roomId: "room-1",
            recipientUserId: "bob",
            senderEphemeralPublicKey: wrapped.senderEphemeralPublicKeyB64,
            nonce: wrapped.nonceB64,
            ciphertext: wrapped.ciphertextB64,
            keyVersion: 1,
            createdAt: new Date().toISOString()
          }
        ]
      ]
    ]),
    latestVersion: new Map([["room-1", 1]])
  };
  await storage.setItem("crewcue.chat.identity.publicKey", bob.publicKeyB64);
  await storage.setItem("crewcue.chat.identity.secretKey", bob.secretKeyB64);
  const api = mockApi(state);
  const result = await ensureRoomKeyReady(storage, api, "room-1", [
    { userId: "alice", publicKey: alice.publicKeyB64 },
    { userId: "bob", publicKey: bob.publicKeyB64 }
  ]);
  assert.equal(result.status, "ready");
  const plaintext = encryptMessage("prior msg", roomKey, 1);
  const decrypted = await import("./crypto.js").then((m) =>
    m.decryptMessage(plaintext, decodeRoomKey(result.status === "ready" ? result.material.keyB64 : ""))
  );
  assert.equal(decrypted, "prior msg");
});

test("roomKey: backup snapshots preserve previously synced room keys", async () => {
  const storage = memoryStorage();
  const alice = generateIdentityKeyPair();
  const state: {
    identities: Map<string, ChatUserIdentity>;
    envelopes: Map<string, ChatKeyEnvelope[]>;
    latestVersion: Map<string, number>;
    backup?: { ciphertext: string; nonce: string; version: number };
  } = {
    identities: new Map([["alice", { userId: "alice", publicKey: alice.publicKeyB64, registeredAt: "" }]]),
    envelopes: new Map<string, ChatKeyEnvelope[]>(),
    latestVersion: new Map<string, number>()
  };
  await storage.setItem("crewcue.chat.identity.publicKey", alice.publicKeyB64);
  await storage.setItem("crewcue.chat.identity.secretKey", alice.secretKeyB64);
  const api = mockApi(state);

  await ensureRoomKeyReady(storage, api, "room-1", [{ userId: "alice", publicKey: alice.publicKeyB64 }]);
  await ensureRoomKeyReady(storage, api, "room-2", [{ userId: "alice", publicKey: alice.publicKeyB64 }]);

  assert.ok(state.backup);
  const localSecret = await ensureBackupLocalSecret(storage);
  const payload = decryptBackupFromServer(state.backup, localSecret);
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload.roomKeys).sort(), ["room-1", "room-2"]);
});

test("roomKey: server rotation creates a fresh key instead of re-uploading stale cached material", async () => {
  const storage = memoryStorage();
  const alice = generateIdentityKeyPair();
  const bob = generateIdentityKeyPair();
  const staleKeyB64 = encodeRoomKey(generateRoomKey());
  const state = {
    identities: new Map([
      ["alice", { userId: "alice", publicKey: alice.publicKeyB64, registeredAt: "" }],
      ["bob", { userId: "bob", publicKey: bob.publicKeyB64, registeredAt: "" }]
    ]),
    envelopes: new Map<string, ChatKeyEnvelope[]>(),
    latestVersion: new Map<string, number>([["room-1", 2]])
  };
  await storage.setItem("crewcue.chat.identity.publicKey", alice.publicKeyB64);
  await storage.setItem("crewcue.chat.identity.secretKey", alice.secretKeyB64);
  await saveLocalRoomKey(storage, "room-1", staleKeyB64, 1);
  const api = mockApi(state);

  const result = await ensureRoomKeyReady(storage, api, "room-1", [
    { userId: "alice", publicKey: alice.publicKeyB64 },
    { userId: "bob", publicKey: bob.publicKeyB64 }
  ]);

  assert.equal(result.status, "ready");
  assert.equal(result.material.keyVersion, 2);
  assert.notEqual(result.material.keyB64, staleKeyB64);
  const envs = state.envelopes.get("room-1") ?? [];
  assert.equal(envs.length, 2);
  assert.deepEqual(
    envs.map((env) => env.keyVersion),
    [2, 2]
  );
});

test("roomKey: backup restore registers restored identity and room key", async () => {
  const storage = memoryStorage();
  const restoredIdentity = generateIdentityKeyPair();
  const restoredRoomKey = encodeRoomKey(generateRoomKey());
  const localSecret = await ensureBackupLocalSecret(storage);
  const payload: ChatBackupPayloadV1 = {
    identitySecretB64: restoredIdentity.secretKeyB64,
    roomKeys: {
      "room-restored": { keyB64: restoredRoomKey, keyVersion: 7 }
    }
  };
  const encryptedBackup = encryptBackupSecret(JSON.stringify(payload), localSecret);
  const state = {
    identities: new Map<string, ChatUserIdentity>(),
    envelopes: new Map<string, ChatKeyEnvelope[]>(),
    latestVersion: new Map<string, number>(),
    backup: {
      ciphertext: encryptedBackup.ciphertextB64,
      nonce: encryptedBackup.nonceB64,
      version: 1
    }
  };
  const api = mockApi(state);

  const identity = await restoreIdentityWithBackup(storage, api);

  assert.equal(identity.publicKeyB64, restoredIdentity.publicKeyB64);
  assert.equal(identity.secretKeyB64, restoredIdentity.secretKeyB64);
  assert.equal(state.identities.get("self")?.publicKey, restoredIdentity.publicKeyB64);
  assert.deepEqual(await loadLocalRoomKey(storage, "room-restored"), {
    keyB64: restoredRoomKey,
    keyVersion: 7
  });
});

test("roomKey: unreadable server backup does not register a replacement identity", async () => {
  const storage = memoryStorage();
  const backedUpIdentity = generateIdentityKeyPair();
  const payload: ChatBackupPayloadV1 = {
    identitySecretB64: backedUpIdentity.secretKeyB64,
    roomKeys: {}
  };
  const encryptedBackup = encryptBackupSecret(JSON.stringify(payload), generateBackupSecret());
  const state = {
    identities: new Map<string, ChatUserIdentity>(),
    envelopes: new Map<string, ChatKeyEnvelope[]>(),
    latestVersion: new Map<string, number>(),
    backup: {
      ciphertext: encryptedBackup.ciphertextB64,
      nonce: encryptedBackup.nonceB64,
      version: 1
    }
  };
  const api = mockApi(state);

  await assert.rejects(
    () => restoreIdentityWithBackup(storage, api),
    /Existing chat identity backup could not be decrypted/
  );
  assert.equal(state.identities.has("self"), false);
});

test("roomKey: unreadable server backup is preserved when local identity continues", async () => {
  const storage = memoryStorage();
  const localIdentity = generateIdentityKeyPair();
  const backedUpIdentity = generateIdentityKeyPair();
  const payload: ChatBackupPayloadV1 = {
    identitySecretB64: backedUpIdentity.secretKeyB64,
    roomKeys: {
      "old-room": { keyB64: encodeRoomKey(generateRoomKey()), keyVersion: 4 }
    }
  };
  const encryptedBackup = encryptBackupSecret(JSON.stringify(payload), generateBackupSecret());
  const originalBackup = {
    ciphertext: encryptedBackup.ciphertextB64,
    nonce: encryptedBackup.nonceB64,
    version: 1
  };
  const state = {
    identities: new Map<string, ChatUserIdentity>(),
    envelopes: new Map<string, ChatKeyEnvelope[]>(),
    latestVersion: new Map<string, number>(),
    backup: { ...originalBackup }
  };
  await storage.setItem("crewcue.chat.identity.publicKey", localIdentity.publicKeyB64);
  await storage.setItem("crewcue.chat.identity.secretKey", localIdentity.secretKeyB64);
  const api = mockApi(state);

  const result = await ensureRoomKeyReady(storage, api, "new-room", [
    { userId: "self", publicKey: localIdentity.publicKeyB64 }
  ]);

  assert.equal(result.status, "ready");
  assert.equal(state.identities.get("self")?.publicKey, localIdentity.publicKeyB64);
  assert.deepEqual(state.backup, originalBackup);
});
