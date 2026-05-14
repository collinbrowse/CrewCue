import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeChannelKey,
  decryptMessage,
  encodeChannelKey,
  encryptMessage,
  generateChannelKey,
  generateDeviceKeyPair,
  unwrapChannelKey,
  wrapChannelKeyForDevice
} from "./crypto";

test("crypto: encrypt/decrypt roundtrip preserves UTF-8 text", () => {
  const key = generateChannelKey();
  const plaintext = "hello crew - emoji included";
  const enc = encryptMessage(plaintext, key, 1);
  assert.equal(enc.keyVersion, 1);
  assert.notEqual(enc.ciphertextB64, plaintext);
  assert.equal(decryptMessage(enc, key), plaintext);
});

test("crypto: tampered ciphertext returns null on decrypt", () => {
  const key = generateChannelKey();
  const enc = encryptMessage("secret", key, 1);
  const bytes = Buffer.from(enc.ciphertextB64, "base64");
  bytes[0] ^= 0xff;
  const tampered = { ...enc, ciphertextB64: bytes.toString("base64") };
  assert.equal(decryptMessage(tampered, key), null);
});

test("crypto: wrong channel key returns null on decrypt", () => {
  const k1 = generateChannelKey();
  const k2 = generateChannelKey();
  const enc = encryptMessage("secret", k1, 1);
  assert.equal(decryptMessage(enc, k2), null);
});

test("crypto: encode/decode channel key roundtrip", () => {
  const key = generateChannelKey();
  const round = decodeChannelKey(encodeChannelKey(key));
  assert.equal(round.length, key.length);
  for (let i = 0; i < key.length; i += 1) {
    assert.equal(round[i], key[i]);
  }
});

test("crypto: wrap/unwrap channel key via recipient device key", () => {
  const recipient = generateDeviceKeyPair();
  const channelKey = generateChannelKey();
  const envelope = wrapChannelKeyForDevice(channelKey, recipient.publicKeyB64, 7);
  assert.equal(envelope.keyVersion, 7);
  const unwrapped = unwrapChannelKey(envelope, recipient.secretKeyB64);
  assert.ok(unwrapped);
  for (let i = 0; i < channelKey.length; i += 1) {
    assert.equal(unwrapped![i], channelKey[i]);
  }
});

test("crypto: unwrapping with wrong recipient secret returns null", () => {
  const recipient = generateDeviceKeyPair();
  const stranger = generateDeviceKeyPair();
  const channelKey = generateChannelKey();
  const envelope = wrapChannelKeyForDevice(channelKey, recipient.publicKeyB64, 1);
  assert.equal(unwrapChannelKey(envelope, stranger.secretKeyB64), null);
});
