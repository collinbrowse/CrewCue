import type { ChatBackupPayloadV1, ChatRoomKeySnapshot } from "@crewcue/contracts";

/** Platform-agnostic secure storage for chat crypto state. */
export interface ChatCryptoStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export type IdentityKeyPair = {
  publicKeyB64: string;
  secretKeyB64: string;
};

export type EncryptedMessage = {
  ciphertextB64: string;
  nonceB64: string;
  keyVersion: number;
};

export type WrappedRoomKey = {
  ciphertextB64: string;
  nonceB64: string;
  senderEphemeralPublicKeyB64: string;
  keyVersion: number;
};

export type RoomMemberIdentity = {
  userId: string;
  publicKey: string;
};

export type RoomKeyMaterial = {
  keyB64: string;
  keyVersion: number;
};

export type BackupSnapshot = ChatBackupPayloadV1;

export type { ChatRoomKeySnapshot };
