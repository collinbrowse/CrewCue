import { createHash } from "node:crypto";

/**
 * Stable race-room id for idempotent creates.
 * Retries with the same user + Idempotency-Key map to the same UUID so a
 * crash/release between persist and idempotency completion cannot orphan a
 * second room.
 */
export function deterministicRaceRoomId(userId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update("crewcue:race-room\0")
    .update(userId)
    .update("\0")
    .update(idempotencyKey)
    .digest();
  // RFC 4122 version 5 + variant bits on a SHA-256 name digest.
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
