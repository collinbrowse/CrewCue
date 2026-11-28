/**
 * Key for the hashed user ids that keep room removals in force after account deletion
 * (roomRemovalStore.ts). A keyed hash, so a copy of the table alone cannot be matched to user ids.
 *
 * Changing the key makes the hashed removals written under the old key stop matching, so set it
 * once per environment and keep it.
 */
import { createHmac } from "node:crypto";

/** Fallback outside production. It is public, so production must never use it. */
export const DEV_ROOM_REMOVAL_HASH_KEY = "dev-only-room-removal-hash-key";

const MIN_KEY_LENGTH = 32;

export type RoomRemovalEnv = { nodeEnv?: string; hashKey?: string };

export function readRoomRemovalEnv(env: NodeJS.ProcessEnv = process.env): RoomRemovalEnv {
  return { nodeEnv: env.NODE_ENV, hashKey: env.ROOM_REMOVAL_HASH_KEY };
}

/** A startup error when production has no private key of its own. */
export function roomRemovalEnvProblem(env: RoomRemovalEnv): string | null {
  if (env.nodeEnv !== "production") return null;
  const key = env.hashKey?.trim() ?? "";
  if (key.length < MIN_KEY_LENGTH || key === DEV_ROOM_REMOVAL_HASH_KEY) {
    return `NODE_ENV=production needs ROOM_REMOVAL_HASH_KEY: a private random string of at least ${MIN_KEY_LENGTH} characters.`;
  }
  return null;
}

export function validateRoomRemovalEnv(env: RoomRemovalEnv = readRoomRemovalEnv()): void {
  const problem = roomRemovalEnvProblem(env);
  if (problem) throw new Error(problem);
}

function hashKey(env: RoomRemovalEnv = readRoomRemovalEnv()): string {
  const key = env.hashKey?.trim();
  if (key) return key;
  if (env.nodeEnv === "production") throw new Error("ROOM_REMOVAL_HASH_KEY is not set");
  return DEV_ROOM_REMOVAL_HASH_KEY;
}

/** HMAC-SHA256 of the user id under a fixed label, hex. Read from env on each call. */
export function hashRemovedUserId(userId: string, env?: RoomRemovalEnv): string {
  return createHmac("sha256", hashKey(env)).update(`crewcue:room-removal:v1:${userId}`, "utf8").digest("hex");
}
