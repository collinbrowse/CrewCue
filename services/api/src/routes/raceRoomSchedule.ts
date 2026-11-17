import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  CrewScheduleSheet,
  PacingEstimate,
  RaceCheckpointSplitRow,
  RaceCourseBaselineTrack,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomStopPlan,
  ScheduleStop,
  ScheduleStopNotesRef
} from "@crewcue/contracts";
import { parsePacingEstimate } from "@crewcue/contracts";
import { finishCheckpointIndex, plannedElapsedSecondsForDistance } from "../lib/raceProjection.js";
import { compareProjectedArrivalToCutoff } from "../lib/cutoffWarning.js";
import {
  getPacingEstimateById,
  initPacingEstimateStore,
  recordPacingEstimateRoom,
  savePacingEstimate,
  type StoredPacingEstimate
} from "../lib/pacingEstimateStore.js";
import { roomUnpaidError } from "../lib/billingEntitlement.js";
import { decidePlanAuthority, isRoomAthlete, planTriggerSchema } from "../lib/planAuthority.js";
import {
  attachBlockedBy,
  courseLengthOf,
  courseLengthsMatch,
  estimateCourseLengthMeters,
  finishOnlyEstimate,
  isTeaserRoom,
  teaserFinishStandInId,
  teaserScheduleRoom,
  teaserScheduleSheet
} from "../lib/raceTeaser.js";
import {
  commitRaceRoomUpdate,
  estimateAtStart,
  evaluateEntitlement,
  getProjectionViewForRoom,
  getRaceRoom,
  refreshProjectionAfterPlanOfRecordChange,
  resolveRouteMetricPointsFromRaceRoomExport,
  type EntitlementOptions
} from "./raceRooms.js";

/** A race's course length as its projection reads it (`courseLengthOf` with the room's route). */
function roomCourseLengthMeters(room: RaceRoom): number | undefined {
  return courseLengthOf(room, resolveRouteMetricPointsFromRaceRoomExport(room));
}

/**
 * The course length a schedule reads its finish at, paid or unpaid: the projection's
 * (`roomCourseLengthMeters`: the stored length, else the route's on a legacy room), else, with
 * neither, the farthest checkpoint. A legacy room with no finish waypoint would otherwise put the
 * plan's finish on its last aid while the projection and the estimator read it at the route end.
 */
function scheduleCourseLengthMeters(room: RaceRoom, checkpoints: RaceCourseCheckpoint[]): number {
  return roomCourseLengthMeters(room) ?? resolveCourseLengthMeters(room, checkpoints);
}

export type ProjectCrewScheduleSheetOptions = {
  /**
   * Closed-visit actual stop seconds by checkpoint id.
   * Incomplete visits (arrival only / null actual) must be omitted — they do not shift ETAs;
   * the sheet keeps planned stoppage + delayOverride until a departure closes the visit.
   */
  closedActualStopSecondsByCheckpointId?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /**
   * Plan-of-record estimate. When set, moving-time baselines come from estimate aid/finish
   * ETAs (plus distance interpolation for unmarked checkpoints). Stoppage/delay/closed-actual
   * overlays still stack on later clocks.
   */
  pacingEstimate?: PacingEstimate;
  /**
   * A checkpoint whose row stands in for the finish line past it: an unpaid race's finish row on
   * a course with no finish waypoint (`teaserFinishStandInId`), which `teaserScheduleRoom` places
   * at the course end. Its arrival is the finish's, after its own stop, as the projection counts
   * every stop toward the finish on such a course.
   */
  finishStandInCheckpointId?: string;
};

/**
 * Closed-visit actual stop seconds per checkpoint for schedule ETA reproject.
 * Open/incomplete visits (`activeActualStopSeconds === null`) are ignored.
 *
 * Last-write-wins (not a sum): prefer the latest `manual_crew` closed visit; otherwise the
 * latest closed auto visit. Summing would double-apply when a crew check-in coexists with a
 * prior closed auto visit (or duplicate closed rows) — EC4.
 */
export function closedActualStopSecondsByCheckpointId(
  splits: readonly RaceCheckpointSplitRow[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const split of splits) {
    let latestManual: number | undefined;
    let latestAnyClosed: number | undefined;
    for (const visit of split.visits) {
      const actual = visit.activeActualStopSeconds;
      if (actual === null || actual === undefined || !Number.isFinite(actual)) {
        continue;
      }
      latestAnyClosed = actual;
      if (visit.resolvedSource === "manual_crew") {
        latestManual = actual;
      }
    }
    const chosen = latestManual ?? latestAnyClosed;
    if (chosen !== undefined) {
      map.set(split.checkpointId, chosen);
    }
  }
  return map;
}

function lookupClosedActualSeconds(
  byCheckpointId: ProjectCrewScheduleSheetOptions["closedActualStopSecondsByCheckpointId"],
  checkpointId: string
): number | undefined {
  if (!byCheckpointId) {
    return undefined;
  }
  if (byCheckpointId instanceof Map) {
    const value = byCheckpointId.get(checkpointId);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  const record = byCheckpointId as Readonly<Record<string, number>>;
  const value = record[checkpointId];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Sends 401/404/403/402 and returns undefined unless the caller is a member of a room they may
 * use. `allowUnpaidRunner` lets the runner through on an unpaid race (onboarding); the route
 * must then serve the teaser (`isTeaserRoom`).
 */
async function requireRoomMember(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  roomId: string,
  entitlementOptions: EntitlementOptions = {}
): Promise<RaceRoom | undefined> {
  if (!request.identity) {
    await reply.code(401).send({ error: "Unauthorized" });
    return undefined;
  }
  const room = await getRaceRoom(roomId);
  if (!room) {
    await reply.code(404).send({ error: "Race room not found" });
    return undefined;
  }
  const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
  if (!membership) {
    await reply.code(403).send({ error: "Forbidden" });
    return undefined;
  }
  const entitlement = evaluateEntitlement(app, room, request.identity.sub, entitlementOptions);
  if (!entitlement.allowed) {
    await reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    return undefined;
  }
  return room;
}

function overlayByCheckpointId(room: RaceRoom): Map<string, RaceRoomStopPlan> {
  const map = new Map<string, RaceRoomStopPlan>();
  for (const plan of room.stopPlans ?? []) {
    map.set(plan.checkpointId, plan);
  }
  return map;
}

function notesRefFromOverlay(overlay: RaceRoomStopPlan | undefined): ScheduleStopNotesRef | undefined {
  if (!overlay) {
    return undefined;
  }
  const notes: ScheduleStopNotesRef = {};
  if (overlay.athleteNotes?.id) {
    notes.athleteNotesId = overlay.athleteNotes.id;
  }
  if (overlay.planNotes?.id) {
    notes.planNotesId = overlay.planNotes.id;
  }
  return notes.athleteNotesId !== undefined || notes.planNotesId !== undefined ? notes : undefined;
}

function checkpointDistanceMeters(checkpoint: RaceCourseCheckpoint): number {
  const distance = checkpoint.distanceMetersFromStart;
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    throw new Error("checkpoint_distance_meters_from_start_required");
  }
  return distance;
}

function resolveCourseLengthMeters(room: RaceRoom, checkpoints: RaceCourseCheckpoint[]): number {
  const fromDerived = room.course?.derivedMetrics?.canonicalDistanceMeters;
  if (typeof fromDerived === "number" && Number.isFinite(fromDerived) && fromDerived >= 0) {
    return fromDerived;
  }
  if (typeof room.courseDistanceMeters === "number" && Number.isFinite(room.courseDistanceMeters)) {
    return room.courseDistanceMeters;
  }
  return Math.max(...checkpoints.map((checkpoint) => checkpointDistanceMeters(checkpoint)), 0);
}

type MovingAnchor = { distanceMeters: number; elapsedSeconds: number };

type ScheduleProjectionLoader = typeof getProjectionViewForRoom;

let scheduleProjectionLoader: ScheduleProjectionLoader = getProjectionViewForRoom;

export function setScheduleProjectionLoaderForTests(loader?: ScheduleProjectionLoader): void {
  scheduleProjectionLoader = loader ?? getProjectionViewForRoom;
}

/**
 * Build moving-time anchors from an estimate: start=0, aid ETAs, finish=expectedFinish at the
 * course length. Unknown checkpoints interpolate by distance between neighboring anchors.
 *
 * The plan's finish goes on the finish checkpoint (`finishCheckpointIndex`, as the projection
 * reads it): the farthest, when it is at the course's end or marked as the finish. A course file
 * with no finish waypoint stops short of the route's end, and its farthest checkpoint is an aid
 * station: it keeps its own ETA (or its interpolation), and the finish is read from the estimate
 * and the projection, not from that row.
 */
export function movingElapsedSecondsFromEstimate(
  estimate: PacingEstimate,
  checkpoints: readonly RaceCourseCheckpoint[],
  courseLengthMeters: number
): Map<string, number> {
  const byId = new Map<string, number>();
  const anchors: MovingAnchor[] = [{ distanceMeters: 0, elapsedSeconds: 0 }];

  for (const eta of estimate.aidEtas) {
    const cp = checkpoints.find((row) => row.id === eta.checkpointId);
    if (!cp) {
      continue;
    }
    const distanceMeters = checkpointDistanceMeters(cp);
    byId.set(eta.checkpointId, eta.elapsedSeconds);
    anchors.push({ distanceMeters, elapsedSeconds: eta.elapsedSeconds });
  }

  const finishElapsed = estimate.expectedFinishElapsedSeconds;
  anchors.push({ distanceMeters: courseLengthMeters, elapsedSeconds: finishElapsed });

  // Stamp the plan finish on the finish checkpoint. An earlier id of `finish` is the first pass
  // of a loop or out-and-back, not the end of the race: only the farthest checkpoint is read.
  const finishCp = checkpoints[finishCheckpointIndex(checkpoints, courseLengthMeters)];
  if (finishCp) {
    byId.set(finishCp.id, finishElapsed);
  }

  anchors.sort((a, b) => a.distanceMeters - b.distanceMeters);
  // Dedupe identical distances (keep last — finish may share course length with last aid).
  const deduped: MovingAnchor[] = [];
  for (const anchor of anchors) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.distanceMeters - anchor.distanceMeters) < 1e-6) {
      deduped[deduped.length - 1] = anchor;
    } else {
      deduped.push(anchor);
    }
  }

  const result = new Map<string, number>();
  for (const checkpoint of checkpoints) {
    const distance = checkpointDistanceMeters(checkpoint);
    const known = byId.get(checkpoint.id);
    if (known !== undefined) {
      result.set(checkpoint.id, known);
      continue;
    }
    if (distance <= 0) {
      result.set(checkpoint.id, 0);
      continue;
    }
    if (distance >= courseLengthMeters) {
      result.set(checkpoint.id, finishElapsed);
      continue;
    }

    let lower = deduped[0]!;
    let upper = deduped[deduped.length - 1]!;
    for (let i = 0; i < deduped.length - 1; i += 1) {
      const a = deduped[i]!;
      const b = deduped[i + 1]!;
      if (distance >= a.distanceMeters && distance <= b.distanceMeters) {
        lower = a;
        upper = b;
        break;
      }
    }
    const span = upper.distanceMeters - lower.distanceMeters;
    const ratio = span > 0 ? (distance - lower.distanceMeters) / span : 0;
    const elapsed = Math.round(
      lower.elapsedSeconds + ratio * (upper.elapsedSeconds - lower.elapsedSeconds)
    );
    result.set(checkpoint.id, Math.max(0, elapsed));
  }

  // Ensure start checkpoints at 0m are zero even without id "start".
  for (const checkpoint of checkpoints) {
    if (checkpointDistanceMeters(checkpoint) === 0) {
      result.set(checkpoint.id, 0);
    }
  }

  return result;
}

/**
 * Build a crew schedule sheet from live checkpoints + stop-plan overlays + closed check-ins.
 * Clock policy:
 * - Moving time from distance/pace (or estimate plan-of-record); a stop’s own stoppage/delay/actual
 *   does not shift its arrival (except a row standing in for the finish past it,
 *   `finishStandInCheckpointId`).
 * - The course length is the projection's (`scheduleCourseLengthMeters`), and the finish row
 *   (`finishCheckpointIndex`) reads the plan's finish there, with or without an estimate.
 * - Later arrivals add cumulative prior planned stoppage + delay overrides, unless a **closed** visit
 *   exists at a prior stop — then that stop contributes `actualStopSeconds` instead
 *   (equiv. shift delta = actual − plannedStoppage − delayOverride; no double-count of delay).
 * - Incomplete visits (arrival only): omitted from closed-actual inputs → no ETA shift until departure.
 */
export function projectCrewScheduleSheet(
  room: RaceRoom,
  options?: ProjectCrewScheduleSheetOptions
): CrewScheduleSheet {
  const course = room.course;
  if (!course) {
    throw new Error("course_required");
  }
  const raceStartAt = room.raceStartAt?.trim();
  if (!raceStartAt) {
    throw new Error("race_start_required");
  }
  const checkpoints = course.checkpoints;
  if (checkpoints.length < 2) {
    throw new Error("checkpoints_insufficient");
  }
  const plannedPaceSecondsPerKm = room.plannedPaceSecondsPerKm;
  if (typeof plannedPaceSecondsPerKm !== "number" || !(plannedPaceSecondsPerKm > 0)) {
    throw new Error("planned_pace_required");
  }

  const raceStartMs = Date.parse(raceStartAt);
  if (Number.isNaN(raceStartMs)) {
    throw new Error("race_start_invalid");
  }

  const estimate = options?.pacingEstimate ?? room.pacingEstimate;
  const overlays = overlayByCheckpointId(room);
  const courseLengthMeters = scheduleCourseLengthMeters(room, checkpoints);
  const ordered = [...checkpoints].sort(
    (a, b) => checkpointDistanceMeters(a) - checkpointDistanceMeters(b)
  );

  const estimateMoving =
    estimate !== undefined
      ? movingElapsedSecondsFromEstimate(estimate, ordered, courseLengthMeters)
      : undefined;
  // Without a plan the finish row reads the plan curve at the course end, where the projection
  // reads the finish, not at a finish waypoint a little short of it.
  const finishCheckpointId = ordered[finishCheckpointIndex(ordered, courseLengthMeters)]?.id;

  let cumulativePriorStoppageSeconds = 0;
  const stops: ScheduleStop[] = [];

  for (const checkpoint of ordered) {
    const overlay = overlays.get(checkpoint.id);
    const plannedStoppageSeconds = Math.max(0, checkpoint.plannedStopSeconds ?? 0);
    const delayOverrideSeconds = overlay?.delayOverrideSeconds;
    const movingSeconds =
      estimateMoving?.get(checkpoint.id) ??
      Math.round(
        plannedElapsedSecondsForDistance({
          distanceMetersFromStart:
            checkpoint.id === finishCheckpointId
              ? Math.max(checkpointDistanceMeters(checkpoint), courseLengthMeters)
              : checkpointDistanceMeters(checkpoint),
          plannedPaceSecondsPerKm,
          baselineTrack: course.baselineTrack,
          courseLengthMeters
        })
      );
    const plannedContribution =
      plannedStoppageSeconds + (delayOverrideSeconds !== undefined ? delayOverrideSeconds : 0);
    const closedActual = lookupClosedActualSeconds(
      options?.closedActualStopSecondsByCheckpointId,
      checkpoint.id
    );
    // Closed visit replaces planned+delay (delta = actual − planned − delay). Incomplete → plan path.
    const stopContribution = closedActual !== undefined ? closedActual : plannedContribution;
    // A row standing in for the finish past it arrives after its own stop, as the finish does.
    const ownStopBeforeArrival = checkpoint.id === options?.finishStandInCheckpointId ? stopContribution : 0;
    const elapsedSeconds = movingSeconds + cumulativePriorStoppageSeconds + ownStopBeforeArrival;
    const notes = notesRefFromOverlay(overlay);
    const clockArrivalAt = new Date(raceStartMs + elapsedSeconds * 1000).toISOString();
    const stop: ScheduleStop = {
      id: `stop-${checkpoint.id}`,
      checkpointId: checkpoint.id,
      clockArrivalAt,
      elapsedSeconds,
      // PR D (#484): expose moving-only elapsed so crews see moving vs cumulative dwell on the row.
      movingElapsedSeconds: movingSeconds,
      plannedStoppageSeconds
    };
    if (delayOverrideSeconds !== undefined) {
      stop.delayOverrideSeconds = delayOverrideSeconds;
    }
    if (notes) {
      stop.notes = notes;
    }
    const cutoffWarning = compareProjectedArrivalToCutoff({
      cutoff: checkpoint.cutoff,
      raceStartAtMs: raceStartMs,
      clockArrivalAtMs: raceStartMs + elapsedSeconds * 1000
    });
    if (cutoffWarning) {
      stop.cutoffStatus = cutoffWarning.cutoffStatus;
      stop.cutoffMarginSeconds = cutoffWarning.cutoffMarginSeconds;
    }
    stops.push(stop);

    cumulativePriorStoppageSeconds += stopContribution;
  }

  const sheet: CrewScheduleSheet = {
    roomId: room.id,
    raceStartAt: new Date(raceStartMs).toISOString(),
    stops
  };
  if (estimate !== undefined) {
    sheet.pacingEstimateId = estimate.id;
  }
  return sheet;
}

const attachPacingEstimateBody = z
  .object({
    pacingEstimateId: z.string().min(1).optional(),
    /** Full estimate snapshot (alternative to id when client already holds POST /pacing-estimates output). */
    estimate: z.unknown().optional(),
    /** Why the plan changes (#538). Absent means "auto", which only the race athlete may use. */
    trigger: planTriggerSchema.optional()
  })
  .strict()
  .refine((body) => body.pacingEstimateId !== undefined || body.estimate !== undefined, {
    message: "pacingEstimateId or estimate required"
  });

type AttachResponse = {
  roomId: string;
  pacingEstimateId: string;
  estimate: PacingEstimate;
};

const COURSE_MISMATCH_BODY = {
  error: "The estimate was computed for a different course length; compute a new one for this course",
  code: "course_mismatch"
} as const;

/** Thrown inside the attach commit when the room's course changed under it (see the attach route). */
class CourseMismatchError extends Error {
  constructor() {
    super(COURSE_MISMATCH_BODY.code);
  }
}

/** The rooms an estimate's provenance names that still exist. */
async function loadProvenanceRooms(stored: StoredPacingEstimate, targetRoomId: string): Promise<RaceRoom[]> {
  const rooms: RaceRoom[] = [];
  for (const id of stored.roomIds) {
    if (id === targetRoomId) continue;
    const room = await getRaceRoom(id);
    if (room && room.id === id) rooms.push(room);
  }
  return rooms;
}

/**
 * Trap 2 (docs/sdlc/pacing-accuracy-program.md, PR A): attaching an estimate does not by itself
 * touch `plannedPaceSecondsPerKm`, so it stays at the 6:00/km GPX fallback (planned course GPX has
 * no timestamps). That value still seeds the PACE badge, `rollingMovingSpeedMps`, the non-baseline
 * ETA branch, and `frozenElapsedAt` in live remaining — so without this the badge keeps reading
 * 9:39/mi next to corrected aid clocks. Derive an average MOVING pace from the estimate so those
 * surfaces agree with the attached plan.
 *
 * Prefer the stored micro-model baseline (the authoritative moving curve); otherwise fall back to
 * the estimate's moving finish over the course length. Returns undefined when nothing usable is
 * available so the caller leaves the existing value untouched.
 */
function derivePlannedPaceSecondsPerKm(
  estimate: PacingEstimate,
  baseline: RaceCourseBaselineTrack | undefined,
  room: RaceRoom
): number | undefined {
  if (baseline && baseline.points.length >= 2) {
    const last = baseline.points[baseline.points.length - 1]!;
    const km = last.distanceMetersFromStart / 1000;
    if (km > 0 && last.referenceElapsedSeconds > 0) {
      return last.referenceElapsedSeconds / km;
    }
  }
  const checkpoints = room.course?.checkpoints;
  if (Array.isArray(checkpoints) && checkpoints.length >= 2) {
    try {
      const km = scheduleCourseLengthMeters(room, checkpoints) / 1000;
      if (km > 0 && estimate.expectedFinishElapsedSeconds > 0) {
        return estimate.expectedFinishElapsedSeconds / km;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function raceRoomScheduleRoutes(app: FastifyInstance): Promise<void> {
  await initPacingEstimateStore(app.log);

  /**
   * Attach a pacing estimate as the room plan of record.
   * Ownership: the race athlete attaches their own estimates for any trigger. Crew members may
   * attach only an estimate built from the athlete's history (owned by the athlete), and only to
   * seed a cold start or on an explicit Recalculate (#538). 401/403 otherwise. Membership and
   * entitlement gate the route; `decidePlanAuthority` decides the role and trigger.
   * Idempotent when the same estimate id is already attached. The attached plan's clocks (finish,
   * bands, aid ETAs) are the race's start now plus its elapsed seconds (`estimateAtStart`), also
   * for an estimate computed before the start moved; the stored estimate is unchanged.
   *
   * An unpaid race takes only `pacingEstimateId` of an estimate the server computed (an inline
   * `estimate` body is 402 `room_unpaid`), only when it was computed for the race's current course
   * length (`courseLengthsMatch` against `courseLengthOf`: the stored length, else the route's;
   * no length and no route never fits), else 400 `course_mismatch`, and answers it finish-only.
   *
   * Attaching adds the room to the stored estimate's `roomIds`. An estimate whose `roomIds` names
   * another race that is unpaid now, and neither this race nor a paid race of the caller's, is
   * 402 `room_unpaid` (`attachBlockedBy`), so a paid race cannot unlock an unpaid race's plan.
   */
  app.put("/race-rooms/:roomId/pacing-estimate", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    // Attaching the plan is part of the runner's setup before they pay.
    const room = await requireRoomMember(app, request, reply, roomId, { allowUnpaidRunner: true });
    if (!room) {
      return;
    }

    const parsedBody = attachPacingEstimateBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid pacing estimate attach payload", code: "invalid_payload" });
    }
    // The plan of an unpaid race is always one the server computed: no client snapshot.
    const unpaid = roomUnpaidError(room);
    if (unpaid && parsedBody.data.estimate !== undefined) {
      return reply.code(402).send(unpaid);
    }

    const callerUserId = request.identity!.sub;
    const membership = room.memberships.find((member) => member.userId === callerUserId);
    const authority = decidePlanAuthority({
      room,
      userId: callerUserId,
      role: membership?.role ?? "",
      trigger: parsedBody.data.trigger ?? "auto"
    });
    if (!authority.ok) {
      return reply.code(authority.status).send({ error: authority.error, code: authority.code });
    }
    const athleteUserId = authority.historyOwnerUserId;
    const crewChange = !isRoomAthlete(room, callerUserId);
    const notTheAthletesEstimate = () =>
      crewChange
        ? reply.code(403).send({ error: "Only an estimate built from the athlete's history can be the plan", code: "plan_authority" })
        : reply.code(403).send({ error: "Forbidden" });
    let estimate: PacingEstimate;
    let storedBaseline: import("@crewcue/contracts").RaceCourseBaselineTrack | undefined;
    /** The stored row this attach uses (its plan curve, and where it was computed or attached). */
    let storedRow: StoredPacingEstimate | undefined;

    if (parsedBody.data.pacingEstimateId !== undefined) {
      const stored = await getPacingEstimateById(parsedBody.data.pacingEstimateId);
      if (!stored) {
        return reply.code(400).send({ error: "Unknown pacingEstimateId", code: "invalid_estimate_id" });
      }
      if (stored.athleteUserId !== athleteUserId) {
        return notTheAthletesEstimate();
      }
      estimate = stored.estimate;
      storedBaseline = stored.baselineTrack;
      storedRow = stored;
    } else {
      if (crewChange) {
        // A snapshot proves nothing about whose history built it.
        return notTheAthletesEstimate();
      }
      try {
        estimate = parsePacingEstimate(parsedBody.data.estimate);
      } catch {
        return reply.code(400).send({ error: "Invalid estimate body", code: "invalid_estimate_body" });
      }
      const existing = await getPacingEstimateById(estimate.id);
      if (existing && existing.athleteUserId !== athleteUserId) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      if (!existing) {
        // Tied to this room, so the export knows whether a paid race unlocked it. A snapshot
        // carries no course, so it is taken to be for the course it is attached to.
        const lengthMeters = roomCourseLengthMeters(room);
        await savePacingEstimate(athleteUserId, estimate, undefined, {
          roomId,
          ...(lengthMeters !== undefined ? { courseLengthMeters: lengthMeters } : {})
        });
      } else {
        storedBaseline = existing.baselineTrack;
        storedRow = existing;
      }
    }

    // An estimate tied to another race that is unpaid stays finish-only until that race is paid:
    // attaching it here (with its plan curve) would unlock it on this race.
    if (storedRow) {
      const blockedBy = attachBlockedBy(storedRow, room, callerUserId, await loadProvenanceRooms(storedRow, roomId));
      const originUnpaid = blockedBy ? roomUnpaidError(blockedBy) : undefined;
      if (originUnpaid) {
        return reply.code(402).send(originUnpaid);
      }
    }

    // An unpaid race takes a plan only for the course length it was computed for. A stored plan
    // re-attached to a shortened course would read its curve at the new finish: a mid-course split.
    // Its own computes read the finish at that length whatever its checkpoints, so checkpoints that
    // stop short of the route's end do not matter here. Paid races take any plan.
    const estimateLengthMeters = storedRow ? estimateCourseLengthMeters(storedRow) : roomCourseLengthMeters(room);
    const courseMismatch = (target: RaceRoom): boolean =>
      isTeaserRoom(target) && !courseLengthsMatch(estimateLengthMeters, roomCourseLengthMeters(target));
    if (courseMismatch(room)) {
      return reply.code(400).send(COURSE_MISMATCH_BODY);
    }

    // Idempotent: same id already plan of record → return current snapshot without rewrite churn.
    // On an unpaid race (only the runner gets this far) the reply is finish-only; the stored plan
    // stays whole. Recording the room only adds it when missing, so the set stays as it was.
    if (room.pacingEstimateId === estimate.id && room.pacingEstimate?.id === estimate.id) {
      if (storedRow) await recordPacingEstimateRoom(storedRow, roomId);
      const body: AttachResponse = {
        roomId,
        pacingEstimateId: estimate.id,
        estimate: isTeaserRoom(room) ? finishOnlyEstimate(room.pacingEstimate) : room.pacingEstimate
      };
      return reply.send(body);
    }

    // `room` was read before the estimate lookup. Attach onto the live room so that
    // await cannot drop a membership that joined while the estimate was loading.
    let updated: RaceRoom | undefined;
    try {
      updated = await commitRaceRoomUpdate(roomId, (latest) => {
        // A course save (or refund) that committed meanwhile decides: check the live room again.
        if (courseMismatch(latest)) {
          throw new CourseMismatchError();
        }
        const derivedPlannedPace = derivePlannedPaceSecondsPerKm(estimate, storedBaseline, latest);
        // The plan's clocks are this race's start plus its elapsed seconds, as PATCH /race-start
        // and a course save keep them: an estimate computed before the start moved keeps its
        // elapsed plan and takes the start as it is now.
        const raceStartAt = latest.raceStartAt?.trim();
        return {
          ...latest,
          pacingEstimateId: estimate.id,
          pacingEstimate: raceStartAt ? estimateAtStart(estimate, raceStartAt) : estimate,
          ...(derivedPlannedPace !== undefined && derivedPlannedPace > 0
            ? { plannedPaceSecondsPerKm: derivedPlannedPace }
            : {}),
          ...(storedBaseline
            ? {
                course: latest.course
                  ? { ...latest.course, baselineTrack: storedBaseline }
                  : latest.course
              }
            : {})
        };
      });
    } catch (error) {
      if (error instanceof CourseMismatchError) {
        return reply.code(400).send(COURSE_MISMATCH_BODY);
      }
      throw error;
    }
    if (!updated) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (storedRow) await recordPacingEstimateRoom(storedRow, roomId);
    // Pace / map read planned splits from the stored projection; schedule rebuilds from the
    // estimate. Refresh projection so those surfaces pick up the new baseline + planned pace.
    await refreshProjectionAfterPlanOfRecordChange(roomId, updated, request.log);

    // The plan of record as attached: its clocks at the race's start.
    const attached = updated.pacingEstimate ?? estimate;
    const body: AttachResponse = {
      roomId,
      pacingEstimateId: estimate.id,
      estimate: isTeaserRoom(updated) ? finishOnlyEstimate(attached) : attached
    };
    return reply.send(body);
  });

  app.get("/race-rooms/:roomId/schedule", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    // Unpaid: the runner sees the start and finish stops only; crew get 402.
    const room = await requireRoomMember(app, request, reply, roomId, { allowUnpaidRunner: true });
    if (!room) {
      return;
    }

    if (!room.course) {
      return reply.code(400).send({ error: "Course required for schedule" });
    }
    if (room.course.checkpoints.length < 2) {
      return reply.code(400).send({ error: "Course must have at least two checkpoints" });
    }
    if (!room.raceStartAt?.trim()) {
      return reply.code(400).send({ error: "raceStartAt required for schedule" });
    }
    if (typeof room.plannedPaceSecondsPerKm !== "number" || !(room.plannedPaceSecondsPerKm > 0)) {
      return reply.code(400).send({ error: "plannedPaceSecondsPerKm required for schedule" });
    }

    let closedActuals: ReturnType<typeof closedActualStopSecondsByCheckpointId> | undefined;
    try {
      const projection = await scheduleProjectionLoader(roomId);
      closedActuals = projection
        ? closedActualStopSecondsByCheckpointId(projection.checkpointSplits)
        : undefined;
    } catch (error) {
      // Do not conflate runtime hydrate failures with schedule math 400s, and do not
      // silently drop check-in shifts (plan-only would be wrong after a closed visit).
      request.log.warn({ err: error, roomId }, "schedule_closed_actuals_unavailable");
      return reply.code(503).send({ error: "Schedule temporarily unavailable" });
    }

    try {
      const teaser = isTeaserRoom(room);
      // A teaser sheet is built from the finish-only plan, the finish at the course length and the
      // plan curve collapsed to its finish, so the start and finish rows it keeps read the finish
      // alone, the same finish the teaser projection shows (see `teaserScheduleRoom`,
      // `teaserScheduleSheet`). On a course with no finish waypoint its finish row stands in for
      // the finish past it, after its own stop (`teaserFinishStandInId`). The course length is the
      // projection's (the route's on a legacy room with no stored length), as on a paid sheet.
      const courseLengthMeters = scheduleCourseLengthMeters(room, room.course.checkpoints);
      const source = teaser ? teaserScheduleRoom(room, courseLengthMeters) : room;
      const finishStandInCheckpointId = teaser ? teaserFinishStandInId(room, courseLengthMeters) : undefined;
      const sheet = projectCrewScheduleSheet(source, {
        closedActualStopSecondsByCheckpointId: closedActuals,
        pacingEstimate: source.pacingEstimate,
        ...(finishStandInCheckpointId !== undefined ? { finishStandInCheckpointId } : {})
      });
      return reply.send(teaser ? teaserScheduleSheet(sheet, room) : sheet);
    } catch (error) {
      const message = error instanceof Error ? error.message : "schedule_projection_failed";
      if (message === "checkpoint_distance_meters_from_start_required") {
        return reply.code(400).send({ error: "Checkpoint distances required for schedule" });
      }
      return reply.code(400).send({ error: "Unable to project schedule" });
    }
  });
}
