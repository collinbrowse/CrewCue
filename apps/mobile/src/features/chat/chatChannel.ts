/**
 * Channel-level orchestration: bootstrap the channel symmetric key for a
 * room (generate-and-distribute on first send, otherwise unwrap from server),
 * encrypt outgoing payloads, decrypt incoming ones.
 *
 * Public API is intentionally narrow: the chat screen calls
 *   - `bootstrapChannelKey(api, roomId, members)` once when the screen mounts
 *   - `encryptOutgoing(roomId, body)` for each send
 *   - `decryptIncoming(roomId, encrypted)` for each rendered message
 */
import type { ApiClient } from "../../api/client";
import {
  decodeChannelKey,
  decryptMessage,
  encodeChannelKey,
  encryptMessage,
  generateChannelKey,
  unwrapChannelKey,
  wrapChannelKeyForDevice,
  type EncryptedMessage,
  type WrappedChannelKey
} from "./crypto";
import { ensureDeviceIdentity, loadChannelKey, saveChannelKey } from "./keyStore";

export type ChannelMember = {
  userId: string;
  /** Map of deviceId -> base64 public key. */
  devices: { deviceId: string; publicKey: string }[];
};

/**
 * Produce a channel key for `roomId`:
 *   1) try local SecureStore cache;
 *   2) try fetching an existing wrapped envelope for this device from server;
 *   3) generate a new key, wrap it for every member device, upload envelopes.
 */
export async function bootstrapChannelKey(
  api: ApiClient,
  roomId: string,
  members: ChannelMember[]
): Promise<{ keyB64: string; keyVersion: number }> {
  const cached = await loadChannelKey(roomId);
  if (cached) return cached;

  const identity = await ensureDeviceIdentity();
  await api.registerChatDevice({
    deviceId: identity.deviceId,
    publicKey: identity.keyPair.publicKeyB64
  });

  const fromServer = await api.listChatKeyEnvelopesForDevice(roomId, identity.deviceId);
  if (fromServer.envelopes.length > 0) {
    const latest = fromServer.envelopes.reduce((acc, e) => (e.keyVersion > acc.keyVersion ? e : acc));
    const envelope: WrappedChannelKey = {
      ciphertextB64: latest.ciphertext,
      nonceB64: latest.nonce,
      senderEphemeralPublicKeyB64: latest.senderEphemeralPublicKey,
      keyVersion: latest.keyVersion
    };
    const unwrapped = unwrapChannelKey(envelope, identity.keyPair.secretKeyB64);
    if (unwrapped) {
      const keyB64 = encodeChannelKey(unwrapped);
      await saveChannelKey(roomId, keyB64, latest.keyVersion);
      return { keyB64, keyVersion: latest.keyVersion };
    }
  }

  const newKey = generateChannelKey();
  const keyVersion = 1;
  const envelopes = [];
  for (const member of members) {
    for (const device of member.devices) {
      const wrapped = wrapChannelKeyForDevice(newKey, device.publicKey, keyVersion);
      envelopes.push({
        recipientUserId: member.userId,
        recipientDeviceId: device.deviceId,
        senderEphemeralPublicKey: wrapped.senderEphemeralPublicKeyB64,
        nonce: wrapped.nonceB64,
        ciphertext: wrapped.ciphertextB64,
        keyVersion
      });
    }
  }
  if (envelopes.length > 0) {
    await api.uploadChatKeyEnvelopes(roomId, envelopes);
  }
  const keyB64 = encodeChannelKey(newKey);
  await saveChannelKey(roomId, keyB64, keyVersion);
  return { keyB64, keyVersion };
}

export function encryptOutgoing(keyB64: string, body: string, keyVersion: number): EncryptedMessage {
  return encryptMessage(body, decodeChannelKey(keyB64), keyVersion);
}

export function decryptIncoming(keyB64: string, payload: EncryptedMessage): string | null {
  return decryptMessage(payload, decodeChannelKey(keyB64));
}
