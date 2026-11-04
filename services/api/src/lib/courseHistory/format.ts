/**
 * One split format for any source's race results (plan PR 2).
 *
 * PR 4 stores this shape as course history and the projection backtest
 * (`services/api/scripts/projection-backtest/`) reads it. A source adapter maps its own results
 * into a {@link CourseHistoryEvent}; nothing downstream knows where the data came from.
 *
 * Times are elapsed seconds from the event's start (`startTime`), so sources that publish clock
 * times convert once at import. Efforts carry no names or bibs.
 */
import { z } from "zod";

export const COURSE_HISTORY_FORMAT_VERSION = 1 as const;

/**
 * Known sources. `file` is a hand-made or exported JSON file in this format; `crewcue` is a
 * finished CrewCue room. Add a source here only once its data may be used (OpenSplitTime waits on
 * permission; LiveTrail's legal notice forbids reuse without written permission).
 */
export const COURSE_HISTORY_SOURCES = ["file", "crewcue", "synthetic"] as const;
export type CourseHistorySource = (typeof COURSE_HISTORY_SOURCES)[number];

export type CourseHistoryCheckpoint = {
  /** Stable within the event; efforts reference checkpoints by this id. */
  id: string;
  name: string;
  /** Distance along the course from the start (m). The first checkpoint is the start at 0. */
  distanceMeters: number;
  latitude?: number;
  longitude?: number;
};

export type CourseHistorySplit = {
  checkpointId: string;
  /** Elapsed seconds from the event start when the runner arrived. */
  inSeconds: number;
  /** Elapsed seconds when the runner left, when the source records it (aid stations). */
  outSeconds?: number;
};

export type CourseHistoryEffort = {
  /**
   * Splits in checkpoint order. A checkpoint may be missing (a missed timing mat) except the
   * finish. The start split is optional; when present its `inSeconds` is the runner's start offset.
   */
  splits: CourseHistorySplit[];
};

export type CourseHistoryEvent = {
  formatVersion: typeof COURSE_HISTORY_FORMAT_VERSION;
  source: CourseHistorySource;
  /** The source's own id for the event (slug, room id, file name). */
  sourceEventId: string;
  name: string;
  /** Race start, ISO-8601 with offset (`…Z`). */
  startTime: string;
  /** Ordered start → finish. */
  checkpoints: CourseHistoryCheckpoint[];
  /** Finishers only. */
  efforts: CourseHistoryEffort[];
};

const finiteNonNegative = z.number().finite().nonnegative();

const checkpointSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  distanceMeters: finiteNonNegative,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

const splitSchema = z.object({
  checkpointId: z.string().min(1),
  inSeconds: finiteNonNegative,
  outSeconds: finiteNonNegative.optional()
});

const eventSchema = z.object({
  formatVersion: z.literal(COURSE_HISTORY_FORMAT_VERSION),
  source: z.enum(COURSE_HISTORY_SOURCES),
  sourceEventId: z.string().min(1),
  name: z.string(),
  startTime: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "startTime must be an ISO date-time"),
  checkpoints: z.array(checkpointSchema).min(2),
  efforts: z.array(z.object({ splits: z.array(splitSchema).min(1) }))
});

export type CourseHistoryValidation =
  | { ok: true; event: CourseHistoryEvent }
  | { ok: false; errors: string[] };

function checkCheckpoints(checkpoints: CourseHistoryCheckpoint[], errors: string[]): void {
  const seen = new Set<string>();
  checkpoints.forEach((cp, index) => {
    if (seen.has(cp.id)) {
      errors.push(`checkpoints[${index}]: duplicate id "${cp.id}"`);
    }
    seen.add(cp.id);
    if ((cp.latitude === undefined) !== (cp.longitude === undefined)) {
      errors.push(`checkpoints[${index}]: latitude and longitude must be given together`);
    }
    if (index === 0 && cp.distanceMeters !== 0) {
      errors.push("checkpoints[0]: the start must be at distanceMeters 0");
    }
    if (index > 0 && cp.distanceMeters <= checkpoints[index - 1]!.distanceMeters) {
      errors.push(`checkpoints[${index}]: distanceMeters must increase along the course`);
    }
  });
}

function checkEffort(
  effort: CourseHistoryEffort,
  effortIndex: number,
  orderOf: Map<string, number>,
  finishId: string,
  errors: string[]
): void {
  const where = `efforts[${effortIndex}]`;
  let lastOrder = -1;
  let lastTime = -Infinity;
  let lastLabel = "";
  for (const [splitIndex, split] of effort.splits.entries()) {
    const order = orderOf.get(split.checkpointId);
    if (order === undefined) {
      errors.push(`${where}.splits[${splitIndex}]: unknown checkpoint "${split.checkpointId}"`);
      return;
    }
    if (order <= lastOrder) {
      errors.push(`${where}.splits[${splitIndex}]: "${split.checkpointId}" is out of checkpoint order or repeated`);
      return;
    }
    if (split.inSeconds < lastTime) {
      errors.push(`${where}.splits[${splitIndex}]: in time at "${split.checkpointId}" is before ${lastLabel}`);
      return;
    }
    if (split.outSeconds !== undefined && split.outSeconds < split.inSeconds) {
      errors.push(`${where}.splits[${splitIndex}]: out time at "${split.checkpointId}" is before its in time`);
      return;
    }
    lastOrder = order;
    lastTime = split.outSeconds ?? split.inSeconds;
    lastLabel = `the ${split.outSeconds !== undefined ? "out" : "in"} time at "${split.checkpointId}"`;
  }
  const last = effort.splits[effort.splits.length - 1];
  if (!last || last.checkpointId !== finishId) {
    errors.push(`${where}: missing the finish split ("${finishId}")`);
  } else if (last.inSeconds <= 0) {
    errors.push(`${where}: finish time must be after the start`);
  }
}

/**
 * Validate an unknown value (a parsed JSON file, an adapter's output) as a course-history event.
 * Rejects out-of-order times, splits at unknown checkpoints, and efforts missing the finish.
 */
export function validateCourseHistoryEvent(input: unknown): CourseHistoryValidation {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    };
  }
  const event = parsed.data as CourseHistoryEvent;
  const errors: string[] = [];
  checkCheckpoints(event.checkpoints, errors);
  const orderOf = new Map(event.checkpoints.map((cp, index) => [cp.id, index]));
  const finishId = event.checkpoints[event.checkpoints.length - 1]!.id;
  event.efforts.forEach((effort, index) => checkEffort(effort, index, orderOf, finishId, errors));
  return errors.length > 0 ? { ok: false, errors } : { ok: true, event };
}

/**
 * The runner's own elapsed time at every checkpoint, measured from their start split (0 when the
 * start isn't recorded), or null when the effort skipped a checkpoint. The backtest only scores
 * efforts with a full set.
 */
export function completeArrivalSeconds(event: CourseHistoryEvent, effort: CourseHistoryEffort): number[] | null {
  const byId = new Map(effort.splits.map((split) => [split.checkpointId, split]));
  const startOffset = byId.get(event.checkpoints[0]!.id)?.inSeconds ?? 0;
  const out: number[] = [0];
  for (const cp of event.checkpoints.slice(1)) {
    const split = byId.get(cp.id);
    if (!split) {
      return null;
    }
    out.push(split.inSeconds - startOffset);
  }
  return out;
}
