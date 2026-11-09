/**
 * One row per race room whose runner crossed the finish (plan PR 6). First-party data, so it
 * needs no outside permission. Feeds three measurements:
 * - plan accuracy per runner-profile branch (calibrates PLAN_LOG_SIGMA once a branch has 20 rooms),
 * - the runner's own late-race slowdown (shrunk into their profile),
 * - stop time per checkpoint by tag, race progress and darkness (the learned default stop, later).
 * Postgres table `finished_efforts` (migration 0016); memory mode keeps a map.
 */
import { getPersistencePool } from "./roomPersistence.js";
import { PLAN_LOG_SIGMA } from "./projectionTuning.js";

export type PlanBranch = keyof typeof PLAN_LOG_SIGMA;

export type FinishedStop = {
  checkpointId: string;
  tags: string[];
  plannedStopSeconds: number;
  actualStopSeconds: number;
  /** Checkpoint distance as a share of the course. */
  progress: number;
  /** The sun was below −6° at the checkpoint when the runner arrived. */
  dark: boolean;
};

export type FinishedEffort = {
  roomId: string;
  athleteUserId: string;
  finishedAt: string;
  courseLengthMeters: number;
  actualFinishSeconds: number;
  /** Plan finish (moving plan + planned stops), when the room had a usable plan. */
  plannedFinishSeconds?: number;
  /** ln(actual ÷ planned finish). */
  planLogError?: number;
  /** Profile branch that built the plan (recorded on the plan since PR 3; absent for older plans). */
  planBranch?: PlanBranch;
  /** Measured late-race slowdown, when the effort was long and complete enough. */
  slowdownSlope?: number;
  stops: FinishedStop[];
};

/** A branch's σ is replaced by its measured value once it has this many finished rooms. */
export const PLAN_SIGMA_MIN_ROOMS = 20;

const memory = new Map<string, FinishedEffort>();

/** Records (or replaces) a room's finished effort. Re-crossing the finish just rewrites it. */
export async function recordFinishedEffort(effort: FinishedEffort): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    memory.set(effort.roomId, structuredClone(effort));
    return;
  }
  await pool.query(
    `INSERT INTO finished_efforts (room_id, athlete_user_id, finished_at, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (room_id) DO UPDATE
     SET athlete_user_id = EXCLUDED.athlete_user_id, finished_at = EXCLUDED.finished_at, payload = EXCLUDED.payload`,
    [effort.roomId, effort.athleteUserId, effort.finishedAt, JSON.stringify(effort)]
  );
}

export async function listFinishedEfforts(filter: { athleteUserId?: string } = {}): Promise<FinishedEffort[]> {
  const pool = getPersistencePool();
  if (!pool) {
    return [...memory.values()]
      .filter((e) => filter.athleteUserId === undefined || e.athleteUserId === filter.athleteUserId)
      .map((e) => structuredClone(e));
  }
  const result = filter.athleteUserId
    ? await pool.query<{ payload: FinishedEffort }>(
        "SELECT payload FROM finished_efforts WHERE athlete_user_id = $1 ORDER BY finished_at",
        [filter.athleteUserId]
      )
    : await pool.query<{ payload: FinishedEffort }>("SELECT payload FROM finished_efforts ORDER BY finished_at");
  return result.rows.map((row) => row.payload);
}

export function resetFinishedEffortsForTests(): void {
  memory.clear();
}

/**
 * Measured plan σ for each branch with at least PLAN_SIGMA_MIN_ROOMS finished rooms: the RMS of
 * ln(actual ÷ planned finish), so a biased plan counts as a less trustworthy one.
 */
export function measuredPlanLogSigma(efforts: readonly FinishedEffort[]): Partial<Record<PlanBranch, { sigma: number; rooms: number }>> {
  const out: Partial<Record<PlanBranch, { sigma: number; rooms: number }>> = {};
  for (const branch of Object.keys(PLAN_LOG_SIGMA) as PlanBranch[]) {
    const errors = efforts
      .filter((e) => e.planBranch === branch && typeof e.planLogError === "number" && Number.isFinite(e.planLogError))
      .map((e) => e.planLogError!);
    if (errors.length >= PLAN_SIGMA_MIN_ROOMS) {
      out[branch] = { sigma: Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length), rooms: errors.length };
    }
  }
  return out;
}

export type StopStat = { tag: string; progressBand: string; dark: boolean; stops: number; medianSeconds: number; medianRatioToPlan: number | null };

/** Median stop time by tag (aid, crew, dropbag, untagged), race-progress quarter and darkness. */
export function stopStats(efforts: readonly FinishedEffort[]): StopStat[] {
  const groups = new Map<string, { tag: string; band: string; dark: boolean; seconds: number[]; ratios: number[] }>();
  for (const effort of efforts) {
    for (const stop of effort.stops) {
      const band = `${Math.min(3, Math.floor(stop.progress * 4)) * 25}-${Math.min(3, Math.floor(stop.progress * 4)) * 25 + 25}%`;
      for (const tag of stop.tags.length > 0 ? stop.tags : ["untagged"]) {
        const key = `${tag}|${band}|${stop.dark}`;
        const group = groups.get(key) ?? { tag, band, dark: stop.dark, seconds: [], ratios: [] };
        group.seconds.push(stop.actualStopSeconds);
        if (stop.plannedStopSeconds > 0) group.ratios.push(stop.actualStopSeconds / stop.plannedStopSeconds);
        groups.set(key, group);
      }
    }
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  return [...groups.values()]
    .map((g) => ({
      tag: g.tag,
      progressBand: g.band,
      dark: g.dark,
      stops: g.seconds.length,
      medianSeconds: median(g.seconds),
      medianRatioToPlan: g.ratios.length > 0 ? median(g.ratios) : null
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag) || a.progressBand.localeCompare(b.progressBand) || Number(a.dark) - Number(b.dark));
}

/**
 * Account deletion: drop finished efforts for this athlete, plus any row for a room being
 * deleted (a room's effort is the runner's data even if the athlete id was re-pointed).
 */
export async function deleteFinishedEffortsForAthlete(athleteUserId: string): Promise<number> {
  const pool = getPersistencePool();
  if (!pool) {
    let removed = 0;
    for (const [roomId, effort] of [...memory.entries()]) {
      if (effort.athleteUserId !== athleteUserId) continue;
      memory.delete(roomId);
      removed += 1;
    }
    return removed;
  }
  const result = await pool.query("DELETE FROM finished_efforts WHERE athlete_user_id = $1", [athleteUserId]);
  return result.rowCount ?? 0;
}

export async function deleteFinishedEffortForRoom(roomId: string): Promise<void> {
  const pool = getPersistencePool();
  if (!pool) {
    memory.delete(roomId);
    return;
  }
  await pool.query("DELETE FROM finished_efforts WHERE room_id = $1", [roomId]);
}
