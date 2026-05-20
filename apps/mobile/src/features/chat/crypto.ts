/** Re-exports from @crewcue/chat-crypto for backward-compatible mobile imports. */
export {
  decodeRoomKey as decodeChannelKey,
  decryptMessage,
  encodeRoomKey as encodeChannelKey,
  encryptMessage,
  generateIdentityKeyPair as generateDeviceKeyPair,
  generateRoomKey as generateChannelKey,
  unwrapRoomKey as unwrapChannelKey,
  wrapRoomKeyForUser as wrapChannelKeyForDevice,
  type EncryptedMessage,
  type IdentityKeyPair as DeviceKeyPair,
  type WrappedRoomKey as WrappedChannelKey
} from "@crewcue/chat-crypto";
