/**
 * Durable athlete path: every accepted location sample per room, oldest first.
 * Postgres table `room_athlete_pings` (PK room_id + recorded_at); memory mode keeps a sorted array.
 * Callers hold the room runtime lock for writes, so appends arrive in recordedAt order.
 */
import { getPersistencePool } from "./roomPersistence.js";

export type StoredTrackPoint = {
  recordedAtMs: number;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  receivedAtMs: number;
  pingId: string;
};

const memoryTracks = new Map<string, StoredTrackPoint[]>();

export async function appendTrackPoints(roomId: string, points: StoredTrackPoint[]): Promise<void> {
  if (points.length === 0) {
    return;
  }
  const pool = getPersistencePool();
  if (!pool) {
    const track = memoryTracks.get(roomId) ?? [];
    const seen = new Set(track.map((p) => p.recordedAtMs));
    for (const point of points) {
      if (!seen.has(point.recordedAtMs)) {
        track.push({ ...point });
        seen.add(point.recordedAtMs);
      }
    }
    track.sort((a, b) => a.recordedAtMs - b.recordedAtMs);
    memoryTracks.set(roomId, track);
    return;
  }
  const values: unknown[] = [];
  const rows = points.map((point, i) => {
    const o = i * 7;
    values.push(
      roomId,
      new Date(point.recordedAtMs).toISOString(),
      point.latitude,
      point.longitude,
      point.accuracyMeters ?? null,
      new Date(point.receivedAtMs).toISOString(),
      point.pingId
    );
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
  });
  await pool.query(
    `INSERT INTO room_athlete_pings
       (room_id, recorded_at, latitude, longitude, accuracy_m, received_at, ping_id)
     VALUES ${rows.join(", ")}
     ON CONFLICT (room_id, recorded_at) DO NOTHING`,
    values
  );
}

/** Which of these sample times are already stored (a replayed upload). */
export async function existingTrackTimes(roomId: string, recordedAtMs: number[]): Promise<Set<number>> {
  if (recordedAtMs.length === 0) {
    return new Set();
  }
  const pool = getPersistencePool();
  if (!pool) {
    const wanted = new Set(recordedAtMs);
    return new Set((memoryTracks.get(roomId) ?? []).map((p) => p.recordedAtMs).filter((t) => wanted.has(t)));
  }
  const result = await pool.query<{ recorded_at: Date }>(
    `SELECT recorded_at FROM room_athlete_pings
     WHERE room_id = $1 AND recorded_at = ANY($2::timestamptz[])`,
    [roomId, recordedAtMs.map((t) => new Date(t).toISOString())]
  );
  return new Set(result.rows.map((row) => row.recorded_at.getTime()));
}

/** Points strictly after `afterMs` (or from the start), oldest first, at most `limit`. */
export async function listTrackPoints(
  roomId: string,
  afterMs: number | undefined,
  limit: number
): Promise<StoredTrackPoint[]> {
  const pool = getPersistencePool();
  if (!pool) {
    const track = memoryTracks.get(roomId) ?? [];
    return track
      .filter((p) => afterMs === undefined || p.recordedAtMs > afterMs)
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }
  const result = await pool.query<{
    recorded_at: Date;
    latitude: number;
    longitude: number;
    accuracy_m: number | null;
    received_at: Date;
    ping_id: string;
  }>(
    `SELECT recorded_at, latitude, longitude, accuracy_m, received_at, ping_id
     FROM room_athlete_pings
     WHERE room_id = $1 AND ($2::timestamptz IS NULL OR recorded_at > $2::timestamptz)
     ORDER BY recorded_at ASC
     LIMIT $3`,
    [roomId, afterMs === undefined ? null : new Date(afterMs).toISOString(), limit]
  );
  return result.rows.map((row) => ({
    recordedAtMs: row.recorded_at.getTime(),
    latitude: row.latitude,
    longitude: row.longitude,
    ...(row.accuracy_m === null ? {} : { accuracyMeters: row.accuracy_m }),
    receivedAtMs: row.received_at.getTime(),
    pingId: row.ping_id
  }));
}

/** Forget a room's path (course replaced, so old progress no longer applies). */
export async function deleteTrack(roomId: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    memoryTracks.delete(roomId);
    return;
  }
  await pool.query("DELETE FROM room_athlete_pings WHERE room_id = $1", [roomId]);
}
