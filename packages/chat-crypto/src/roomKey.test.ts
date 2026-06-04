import test from "node:test";
import assert from "node:assert/strict";
import type { ChatKeyEnvelope, ChatUserIdentity } from "@crewcue/contracts";
import {
  decodeRoomKey,
  encodeRoomKey,
  encryptMessage,
  generateIdentityKeyPair,
  generateRoomKey,
  wrapRoomKeyForUser
} from "./crypto.js";
import {
  decryptBackupFromServer,
  ensureBackupLocalSecret,
  ensureIdentity,
  saveLocalRoomKey
} from "./identity.js";
import type { ChatCryptoStorageAdapter } from "./types.js";
import { ensureRoomKeyReady, type ChatCryptoApi } from "./roomKey.js";

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
