/**
 * Crew chat E2E crypto (tweetnacl). No React Native imports.
 */
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } = naclUtil as {
  decodeBase64: (s: string) => Uint8Array;
  decodeUTF8: (s: string) => Uint8Array;
  encodeBase64: (b: Uint8Array) => string;
  encodeUTF8: (b: Uint8Array) => string;
};
import type { EncryptedMessage, IdentityKeyPair, WrappedRoomKey } from "./types.js";

function installTweetnaclPrng(): void {
  const g = globalThis as typeof globalThis & { crypto?: Crypto };
  if (typeof g.crypto?.getRandomValues === "function") {
    nacl.setPRNG((x, n) => {
      const v = new Uint8Array(n);
      g.crypto!.getRandomValues(v);
      x.set(v);
    });
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
    nacl.setPRNG((x, n) => {
      x.set(randomBytes(n));
    });
  } catch {
    // Node tests without node:crypto resolution still get Web Crypto in modern runtimes.
  }
}

installTweetnaclPrng();

export function generateIdentityKeyPair(): IdentityKeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey)
  };
}

export function publicKeyFromIdentitySecret(secretKeyB64: string): string {
  const secret = decodeBase64(secretKeyB64);
  const kp = nacl.box.keyPair.fromSecretKey(secret);
  return encodeBase64(kp.publicKey);
}

export function generateRoomKey(): Uint8Array {
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

export function encodeRoomKey(key: Uint8Array): string {
  return encodeBase64(key);
}

export function decodeRoomKey(b64: string): Uint8Array {
  const bytes = decodeBase64(b64);
  if (bytes.length !== nacl.secretbox.keyLength) {
    throw new Error("decodeRoomKey: invalid key length");
  }
  return bytes;
}

export function encryptMessage(plaintext: string, roomKey: Uint8Array, keyVersion: number): EncryptedMessage {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = decodeUTF8(plaintext);
  const ciphertext = nacl.secretbox(message, nonce, roomKey);
  return {
    ciphertextB64: encodeBase64(ciphertext),
    nonceB64: encodeBase64(nonce),
    keyVersion
  };
}

export function decryptMessage(payload: EncryptedMessage, roomKey: Uint8Array): string | null {
  try {
    const ciphertext = decodeBase64(payload.ciphertextB64);
    const nonce = decodeBase64(payload.nonceB64);
    const opened = nacl.secretbox.open(ciphertext, nonce, roomKey);
    if (!opened) return null;
    return encodeUTF8(opened);
  } catch {
    return null;
  }
}

export function wrapRoomKeyForUser(
  roomKey: Uint8Array,
  recipientPublicKeyB64: string,
  keyVersion: number
): WrappedRoomKey {
  const ephemeral = nacl.box.keyPair();
  const recipientPub = decodeBase64(recipientPublicKeyB64);
  if (recipientPub.length !== nacl.box.publicKeyLength) {
    throw new Error("wrapRoomKeyForUser: invalid recipient public key length");
  }
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(roomKey, nonce, recipientPub, ephemeral.secretKey);
  return {
    ciphertextB64: encodeBase64(ciphertext),
    nonceB64: encodeBase64(nonce),
    senderEphemeralPublicKeyB64: encodeBase64(ephemeral.publicKey),
    keyVersion
  };
}

export function unwrapRoomKey(envelope: WrappedRoomKey, recipientSecretKeyB64: string): Uint8Array | null {
  try {
    const ciphertext = decodeBase64(envelope.ciphertextB64);
    const nonce = decodeBase64(envelope.nonceB64);
    const senderPub = decodeBase64(envelope.senderEphemeralPublicKeyB64);
    const recipientSec = decodeBase64(recipientSecretKeyB64);
    return nacl.box.open(ciphertext, nonce, senderPub, recipientSec);
  } catch {
    return null;
  }
}

export function encryptBackupSecret(plaintextUtf8: string, backupSecretB64: string): { ciphertextB64: string; nonceB64: string } {
  const key = decodeBackupSecret(backupSecretB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(decodeUTF8(plaintextUtf8), nonce, key);
  return { ciphertextB64: encodeBase64(ciphertext), nonceB64: encodeBase64(nonce) };
}

export function decryptBackupSecret(
  ciphertextB64: string,
  nonceB64: string,
  backupSecretB64: string
): string | null {
  try {
    const key = decodeBackupSecret(backupSecretB64);
    const opened = nacl.secretbox.open(decodeBase64(ciphertextB64), decodeBase64(nonceB64), key);
    if (!opened) return null;
    return encodeUTF8(opened);
  } catch {
    return null;
  }
}

function decodeBackupSecret(b64: string): Uint8Array {
  const bytes = decodeBase64(b64);
  if (bytes.length !== nacl.secretbox.keyLength) {
    throw new Error("decodeBackupSecret: invalid secret length");
  }
  return bytes;
}

export function generateBackupSecret(): string {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}
