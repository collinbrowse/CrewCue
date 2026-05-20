import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptBackupSecret,
  decryptMessage,
  encodeRoomKey,
  encryptBackupSecret,
  encryptMessage,
  generateBackupSecret,
  generateIdentityKeyPair,
  generateRoomKey,
  unwrapRoomKey,
  wrapRoomKeyForUser
} from "./crypto.js";

test("crypto: encrypt/decrypt message roundtrip", () => {
  const key = generateRoomKey();
  const enc = encryptMessage("hello crew", key, 1);
  assert.equal(decryptMessage(enc, key), "hello crew");
});

test("crypto: wrap/unwrap room key for user identity", () => {
  const recipient = generateIdentityKeyPair();
  const roomKey = generateRoomKey();
  const envelope = wrapRoomKeyForUser(roomKey, recipient.publicKeyB64, 2);
  const unwrapped = unwrapRoomKey(envelope, recipient.secretKeyB64);
  assert.ok(unwrapped);
  assert.equal(encodeRoomKey(unwrapped!), encodeRoomKey(roomKey));
});

test("crypto: backup encrypt/decrypt roundtrip", () => {
  const secret = generateBackupSecret();
  const payload = JSON.stringify({ identitySecretB64: "sec", roomKeys: {} });
  const boxed = encryptBackupSecret(payload, secret);
  assert.equal(decryptBackupSecret(boxed.ciphertextB64, boxed.nonceB64, secret), payload);
});
