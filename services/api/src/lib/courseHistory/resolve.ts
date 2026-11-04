/**
 * Which past events a room's course uses, and the cohort built from them (plan PR 4).
 *
 * An operator link (`RaceRoom.courseHistoryEventIds`, set by `npm run course-history:link`) wins.
 * Otherwise the course auto-links to product events that match it unambiguously. Cohorts are cached
 * per course for a few minutes so the per-ping projection doesn't reread the store.
 */
import type { RaceCourse, RaceRoomProjectionCore } from "@crewcue/contracts";
import { autoLinkEventIds } from "./link.js";
import { buildCohort, cohortIsUsable, pastRunnersElapsed, type Cohort } from "./cohort.js";
import { getCourseHistoryEvents, listCourseHistoryEvents } from "./store.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; cohort: Cohort }>();

function cacheKey(course: RaceCourse, linkedIds: readonly string[] | undefined): string {
  return JSON.stringify([
    linkedIds ?? null,
    course.checkpoints.map((cp) => [cp.id, cp.latitude, cp.longitude, cp.distanceMetersFromStart, cp.title ?? ""])
  ]);
}

export function clearCourseHistoryCacheForTests(): void {
  cache.clear();
}

/**
 * The cohort for this course, or null when nothing links or fewer than 25 finishers line up.
 * `linkedIds` is the room's operator link (`RaceRoom.courseHistoryEventIds`); absent = auto-link.
 */
export async function cohortForCourse(course: RaceCourse, linkedIds?: readonly string[]): Promise<Cohort | null> {
  const key = cacheKey(course, linkedIds);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return cohortIsUsable(hit.cohort) ? hit.cohort : null;
  }
  let events;
  if (linkedIds) {
    events = await getCourseHistoryEvents(linkedIds);
  } else {
    const product = await listCourseHistoryEvents({ usage: "product" });
    const ids = new Set(autoLinkEventIds(course, product));
    events = product.filter((e) => ids.has(e.id));
  }
  const cohort = buildCohort(course, events);
  cache.set(key, { at: Date.now(), cohort });
  return cohortIsUsable(cohort) ? cohort : null;
}

/**
 * Live blend: each remaining ETA becomes the average of the projection's and the past-runners
 * estimate, standing at the last cohort checkpoint the runner crossed. ETAs without a past-runners
 * answer (too few similar finishers, or a checkpoint outside the cohort) keep the projection's.
 */
export function blendWithCohort(core: RaceRoomProjectionCore, cohort: Cohort, raceStartMs: number): RaceRoomProjectionCore {
  const index = new Map(cohort.checkpointIds.map((id, i) => [id, i]));
  let k = -1;
  let elapsedAtK = 0;
  for (const row of core.checkpointSplits) {
    const i = index.get(row.checkpointId);
    if (i !== undefined && i > 0 && row.actualElapsedSecondsAtCross != null) {
      k = i;
      elapsedAtK = row.actualElapsedSecondsAtCross;
    }
  }
  if (k <= 0) return core;
  const finishId = cohort.checkpointIds[cohort.checkpointIds.length - 1]!;
  const remaining = (core.remainingCheckpointEtas ?? []).map((eta) => {
    const j = index.get(eta.checkpointId);
    const past = j !== undefined && j > k ? pastRunnersElapsed(cohort, k, j, elapsedAtK) : null;
    if (past === null) return eta;
    const liveProjectedElapsedSeconds = Math.round((eta.liveProjectedElapsedSeconds + past) / 2);
    return { ...eta, liveProjectedElapsedSeconds, deltaSecondsVsFrozenPlan: liveProjectedElapsedSeconds - eta.frozenPlanElapsedSeconds };
  });
  const finishPast = pastRunnersElapsed(cohort, k, cohort.checkpointIds.length - 1, elapsedAtK);
  const finishEta = remaining.find((eta) => eta.checkpointId === finishId);
  let etaFinishPlanIso = core.etaFinishPlanIso;
  if (finishEta) {
    etaFinishPlanIso = new Date(raceStartMs + finishEta.liveProjectedElapsedSeconds * 1000).toISOString();
  } else if (finishPast !== null) {
    const live = (Date.parse(core.etaFinishPlanIso) - raceStartMs) / 1000;
    etaFinishPlanIso = new Date(raceStartMs + ((live + finishPast) / 2) * 1000).toISOString();
  }
  return { ...core, remainingCheckpointEtas: remaining, etaFinishPlanIso };
}
