/**
 * People the race owner removed from a room (migration 0022). Join by code refuses them, and an
 * invite admits them only when the owner issued it after the removal. Kept out of the room
 * payload so clients never see who was removed. Memory mode keeps maps.
 *
 * Account deletion keeps the removals but not the raw user id: it moves them to
 * `room_removed_member_hashes` (migration 0024) under a keyed hash of the id (roomRemovalEnv.ts).
 * A sign-in that comes back with the same id still matches them.
 */
import { getPersistencePool } from "./roomPersistence.js";
import { hashRemovedUserId } from "./roomRemovalEnv.js";

const memory = new Map<string, string>();
const memoryHashed = new Map<string, string>();

function memoryKey(roomId: string, userIdOrHash: string): string {
  return `${roomId}\u0000${userIdOrHash}`;
}

function later(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Records (or refreshes) a removal. */
export async function recordRoomRemoval(roomId: string, userId: string, removedAt: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    memory.set(memoryKey(roomId, userId), removedAt);
    return;
  }
  await pool.query(
    `INSERT INTO room_removed_members (room_id, user_id, removed_at)
     VALUES ($1, $2, $3::timestamptz)
     ON CONFLICT (room_id, user_id) DO UPDATE SET removed_at = EXCLUDED.removed_at`,
    [roomId, userId, removedAt]
  );
}

/**
 * When the user was last removed from the room, or undefined when they never were. Matches the
 * raw id and the hashed id a deleted account left behind.
 */
export async function roomRemovedAt(roomId: string, userId: string): Promise<string | undefined> {
  const userHash = hashRemovedUserId(userId);
  const pool = getPersistencePool();
  if (!pool) {
    return later(memory.get(memoryKey(roomId, userId)), memoryHashed.get(memoryKey(roomId, userHash)));
  }
  const result = await pool.query<{ removed_at: Date | null }>(
    `SELECT GREATEST(
       (SELECT removed_at FROM room_removed_members WHERE room_id = $1 AND user_id = $2),
       (SELECT removed_at FROM room_removed_member_hashes WHERE room_id = $1 AND user_hash = $3)
     ) AS removed_at`,
    [roomId, userId, userHash]
  );
  return result.rows[0]?.removed_at?.toISOString();
}

export async function clearRoomRemoval(roomId: string, userId: string): Promise<void> {
  const userHash = hashRemovedUserId(userId);
  const pool = getPersistencePool();
  if (!pool) {
    memory.delete(memoryKey(roomId, userId));
    memoryHashed.delete(memoryKey(roomId, userHash));
    return;
  }
  await pool.query("DELETE FROM room_removed_members WHERE room_id = $1 AND user_id = $2", [roomId, userId]);
  await pool.query("DELETE FROM room_removed_member_hashes WHERE room_id = $1 AND user_hash = $2", [roomId, userHash]);
}

export async function deleteRoomRemovalsForRoom(roomId: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    for (const map of [memory, memoryHashed]) {
      for (const key of map.keys()) if (key.startsWith(`${roomId}\u0000`)) map.delete(key);
    }
    return;
  }
  await pool.query("DELETE FROM room_removed_members WHERE room_id = $1", [roomId]);
  await pool.query("DELETE FROM room_removed_member_hashes WHERE room_id = $1", [roomId]);
}

/**
 * Account deletion: the user's removals stay in force under the hashed id, and the rows that
 * carry the raw id go. One statement in Postgres, so a failure leaves the raw rows in place for
 * the retry. Returns how many removals were kept.
 */
export async function hashRoomRemovalsForDeletedUser(userId: string): Promise<number> {
  const userHash = hashRemovedUserId(userId);
  const pool = getPersistencePool();
  if (!pool) {
    let moved = 0;
    for (const [key, removedAt] of memory) {
      if (!key.endsWith(`\u0000${userId}`)) continue;
      const roomId = key.slice(0, key.length - userId.length - 1);
      const hashedKey = memoryKey(roomId, userHash);
      memoryHashed.set(hashedKey, later(memoryHashed.get(hashedKey), removedAt)!);
      memory.delete(key);
      moved += 1;
    }
    return moved;
  }
  const result = await pool.query(
    `WITH moved AS (
       DELETE FROM room_removed_members WHERE user_id = $1 RETURNING room_id, removed_at
     )
     INSERT INTO room_removed_member_hashes (room_id, user_hash, removed_at)
     SELECT room_id, $2, removed_at FROM moved
     ON CONFLICT (room_id, user_hash)
       DO UPDATE SET removed_at = GREATEST(room_removed_member_hashes.removed_at, EXCLUDED.removed_at)`,
    [userId, userHash]
  );
  return result.rowCount ?? 0;
}

/** Test helper: whether any removal row still carries this raw user id. */
export async function hasRawRoomRemovalsForUser(userId: string): Promise<boolean> {
  const pool = getPersistencePool();
  if (!pool) {
    for (const key of memory.keys()) if (key.endsWith(`\u0000${userId}`)) return true;
    return false;
  }
  const result = await pool.query("SELECT 1 FROM room_removed_members WHERE user_id = $1 LIMIT 1", [userId]);
  return (result.rowCount ?? 0) > 0;
}
