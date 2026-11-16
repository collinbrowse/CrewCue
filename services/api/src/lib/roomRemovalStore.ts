/**
 * People the race owner removed from a room (migration 0020). Join by code refuses them, and an
 * invite admits them only when the owner issued it after the removal. Kept out of the room
 * payload so clients never see who was removed. Memory mode keeps a map.
 */
import { getPersistencePool } from "./roomPersistence.js";

const memory = new Map<string, string>();

function memoryKey(roomId: string, userId: string): string {
  return `${roomId}\u0000${userId}`;
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

/** When the user was last removed from the room, or undefined when they never were. */
export async function roomRemovedAt(roomId: string, userId: string): Promise<string | undefined> {
  const pool = getPersistencePool();
  if (!pool) {
    return memory.get(memoryKey(roomId, userId));
  }
  const result = await pool.query<{ removed_at: Date }>(
    "SELECT removed_at FROM room_removed_members WHERE room_id = $1 AND user_id = $2",
    [roomId, userId]
  );
  return result.rows[0]?.removed_at.toISOString();
}

export async function clearRoomRemoval(roomId: string, userId: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    memory.delete(memoryKey(roomId, userId));
    return;
  }
  await pool.query("DELETE FROM room_removed_members WHERE room_id = $1 AND user_id = $2", [roomId, userId]);
}

export async function deleteRoomRemovalsForRoom(roomId: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    for (const key of memory.keys()) if (key.startsWith(`${roomId}\u0000`)) memory.delete(key);
    return;
  }
  await pool.query("DELETE FROM room_removed_members WHERE room_id = $1", [roomId]);
}

export async function deleteRoomRemovalsForUser(userId: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    for (const key of memory.keys()) if (key.endsWith(`\u0000${userId}`)) memory.delete(key);
    return;
  }
  await pool.query("DELETE FROM room_removed_members WHERE user_id = $1", [userId]);
}
