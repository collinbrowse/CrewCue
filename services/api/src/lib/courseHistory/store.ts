/**
 * Course history storage (plan PR 4): imported or CrewCue-recorded race results in the split format.
 *
 * Each event's `usage` is set from its source at import:
 * - `product`: may feed estimates and live ETAs. Only sources listed in
 *   COURSE_HISTORY_PRODUCT_SOURCES (env, comma-separated, default `crewcue,opensplittime`).
 * - `backtest_only`: stored for analysis, never read by the product.
 * Re-importing an event (same source and sourceEventId) replaces it.
 * Postgres table `course_history_events` (migration 0017); memory mode keeps a map.
 */
import { getPersistencePool } from "../roomPersistence.js";
import { validateCourseHistoryEvent, type CourseHistoryEvent } from "./format.js";

export type CourseHistoryUsage = "product" | "backtest_only";

export type StoredCourseHistoryEvent = {
  id: string;
  usage: CourseHistoryUsage;
  importedAt: string;
  event: CourseHistoryEvent;
};

/**
 * Sources whose data may feed the product. OpenSplitTime is on by default since it granted
 * permission (Nov 2026); set the env to `crewcue` to take it back off without a deploy of code.
 */
export const DEFAULT_PRODUCT_SOURCES = "crewcue,opensplittime";

export function productSources(): Set<string> {
  const raw = process.env.COURSE_HISTORY_PRODUCT_SOURCES?.trim();
  return new Set((raw && raw.length > 0 ? raw : DEFAULT_PRODUCT_SOURCES).split(",").map((s) => s.trim()).filter(Boolean));
}

export function usageFor(source: string): CourseHistoryUsage {
  return productSources().has(source) ? "product" : "backtest_only";
}

export function courseHistoryEventId(event: Pick<CourseHistoryEvent, "source" | "sourceEventId">): string {
  return `${event.source}:${event.sourceEventId}`;
}

const memory = new Map<string, StoredCourseHistoryEvent>();

/**
 * Stores events, all or nothing: every event is validated first, and in Postgres the writes run in
 * one transaction. Returns what was stored.
 */
export async function importCourseHistoryEvents(events: readonly CourseHistoryEvent[]): Promise<StoredCourseHistoryEvent[]> {
  const errors: string[] = [];
  for (const [i, event] of events.entries()) {
    const result = validateCourseHistoryEvent(event);
    if (!result.ok) errors.push(...result.errors.map((e) => `[${i}] ${e}`));
  }
  if (errors.length > 0) {
    throw new Error(`course history import rejected, nothing stored: ${errors.slice(0, 5).join("; ")}`);
  }
  const importedAt = new Date().toISOString();
  const rows = events.map((event) => ({
    id: courseHistoryEventId(event),
    usage: usageFor(event.source),
    importedAt,
    event: structuredClone(event)
  }));
  const pool = getPersistencePool();
  if (!pool) {
    for (const row of rows) memory.set(row.id, row);
    return rows;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO course_history_events (id, source, source_event_id, usage, name, start_at, imported_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (id) DO UPDATE
         SET usage = EXCLUDED.usage, name = EXCLUDED.name, start_at = EXCLUDED.start_at,
             imported_at = EXCLUDED.imported_at, payload = EXCLUDED.payload`,
        [row.id, row.event.source, row.event.sourceEventId, row.usage, row.event.name, row.event.startTime, row.importedAt, JSON.stringify(row.event)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return rows;
}

/** Events by id (any usage). Missing ids are skipped. */
export async function getCourseHistoryEvents(ids: readonly string[]): Promise<StoredCourseHistoryEvent[]> {
  if (ids.length === 0) return [];
  const pool = getPersistencePool();
  if (!pool) {
    return ids.flatMap((id) => (memory.has(id) ? [structuredClone(memory.get(id)!)] : []));
  }
  const result = await pool.query<{ id: string; usage: CourseHistoryUsage; imported_at: Date; payload: CourseHistoryEvent }>(
    "SELECT id, usage, imported_at, payload FROM course_history_events WHERE id = ANY($1::text[])",
    [ids]
  );
  return result.rows.map((row) => ({ id: row.id, usage: row.usage, importedAt: row.imported_at.toISOString(), event: row.payload }));
}

export async function listCourseHistoryEvents(filter: { usage?: CourseHistoryUsage } = {}): Promise<StoredCourseHistoryEvent[]> {
  const pool = getPersistencePool();
  if (!pool) {
    return [...memory.values()].filter((row) => !filter.usage || row.usage === filter.usage).map((row) => structuredClone(row));
  }
  const result = filter.usage
    ? await pool.query<{ id: string; usage: CourseHistoryUsage; imported_at: Date; payload: CourseHistoryEvent }>(
        "SELECT id, usage, imported_at, payload FROM course_history_events WHERE usage = $1",
        [filter.usage]
      )
    : await pool.query<{ id: string; usage: CourseHistoryUsage; imported_at: Date; payload: CourseHistoryEvent }>(
        "SELECT id, usage, imported_at, payload FROM course_history_events"
      );
  return result.rows.map((row) => ({ id: row.id, usage: row.usage, importedAt: row.imported_at.toISOString(), event: row.payload }));
}

export function resetCourseHistoryForTests(): void {
  memory.clear();
}
