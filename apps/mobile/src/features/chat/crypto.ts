/**
 * Crew chat E2E crypto helpers built on tweetnacl.
 *
 * Strategy:
 *   - Each device has a long-lived Curve25519 keypair stored in SecureStore.
 *   - Each crew chat channel has a 32-byte symmetric key (XSalsa20-Poly1305
 *     via `nacl.secretbox`) used to encrypt every message.
 *   - The channel key is wrapped per-recipient device using `nacl.box`
 *     (Curve25519 + XSalsa20-Poly1305 with an ephemeral sender keypair). The
 *     wrapped envelopes are uploaded to the server, which never sees the key
 *     in plaintext.
 *   - The server stores only ciphertext (Stream Chat payloads) and
 *     ciphertext envelopes; it cannot read message content.
 *
 * All inputs/outputs cross the wire as base64 strings.
 */
import nacl from "tweetnacl";
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from "tweetnacl-util";

export type DeviceKeyPair = {
  publicKeyB64: string;
  secretKeyB64: string;
};

export type EncryptedMessage = {
  ciphertextB64: string;
  nonceB64: string;
  keyVersion: number;
};

export type WrappedChannelKey = {
  ciphertextB64: string;
  nonceB64: string;
  senderEphemeralPublicKeyB64: string;
  keyVersion: number;
};

/** Generate a fresh Curve25519 keypair for this device. */
export function generateDeviceKeyPair(): DeviceKeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey)
  };
}

/** Generate a fresh 32-byte symmetric channel key. */
export function generateChannelKey(): Uint8Array {
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

/** Encode a channel key for storage/transport (base64). */
export function encodeChannelKey(key: Uint8Array): string {
  return encodeBase64(key);
}

/** Decode a channel key from base64; throws if length is wrong. */
export function decodeChannelKey(b64: string): Uint8Array {
  const bytes = decodeBase64(b64);
  if (bytes.length !== nacl.secretbox.keyLength) {
    throw new Error("decodeChannelKey: invalid key length");
  }
  return bytes;
}

/**
 * Encrypt a UTF-8 message body with the channel key. Returns base64 nonce +
 * ciphertext suitable for transport/persistence.
 */
export function encryptMessage(plaintext: string, channelKey: Uint8Array, keyVersion: number): EncryptedMessage {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = decodeUTF8(plaintext);
  const ciphertext = nacl.secretbox(message, nonce, channelKey);
  return {
    ciphertextB64: encodeBase64(ciphertext),
    nonceB64: encodeBase64(nonce),
    keyVersion
  };
}

/**
 * Decrypt a previously encrypted message body. Returns `null` on tamper /
 * wrong key (does not throw to keep callers simple).
 */
export function decryptMessage(payload: EncryptedMessage, channelKey: Uint8Array): string | null {
  try {
    const ciphertext = decodeBase64(payload.ciphertextB64);
    const nonce = decodeBase64(payload.nonceB64);
    const opened = nacl.secretbox.open(ciphertext, nonce, channelKey);
    if (!opened) return null;
    return encodeUTF8(opened);
  } catch {
    return null;
  }
}

/**
 * Wrap a channel key for a single recipient device using their public key.
 * Uses an ephemeral sender keypair to keep forward-ish security: the sender's
 * long-term key is never required for envelope creation.
 */
export function wrapChannelKeyForDevice(
  channelKey: Uint8Array,
  recipientPublicKeyB64: string,
  keyVersion: number
): WrappedChannelKey {
  const ephemeral = nacl.box.keyPair();
  const recipientPub = decodeBase64(recipientPublicKeyB64);
  if (recipientPub.length !== nacl.box.publicKeyLength) {
    throw new Error("wrapChannelKeyForDevice: invalid recipient public key length");
  }
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(channelKey, nonce, recipientPub, ephemeral.secretKey);
  return {
    ciphertextB64: encodeBase64(ciphertext),
    nonceB64: encodeBase64(nonce),
    senderEphemeralPublicKeyB64: encodeBase64(ephemeral.publicKey),
    keyVersion
  };
}

/** Unwrap a channel key envelope using this device's secret key. Returns null on failure. */
export function unwrapChannelKey(
  envelope: WrappedChannelKey,
  recipientSecretKeyB64: string
): Uint8Array | null {
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
