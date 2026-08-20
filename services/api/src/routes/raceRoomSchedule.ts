import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  CrewScheduleSheet,
  PacingEstimate,
  RaceCheckpointSplitRow,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomStopPlan,
  ScheduleStop,
  ScheduleStopNotesRef
} from "@crewcue/contracts";
import { parsePacingEstimate } from "@crewcue/contracts";
import { plannedElapsedSecondsForDistance } from "../lib/raceProjection.js";
import { compareProjectedArrivalToCutoff } from "../lib/cutoffWarning.js";
import {
  getPacingEstimateById,
  initPacingEstimateStore,
  savePacingEstimate
} from "../lib/pacingEstimateStore.js";
import { evaluateEntitlement, getProjectionViewForRoom, getRaceRoom, requireCourseEditor, saveRaceRoom } from "./raceRooms.js";

export type ProjectCrewScheduleSheetOptions = {
  /**
   * Closed-visit actual stop seconds by checkpoint id.
   * Incomplete visits (arrival only / null actual) must be omitted — they do not shift ETAs;
   * the sheet keeps planned dwell + delayOverride until a departure closes the visit.
   */
  closedActualStopSecondsByCheckpointId?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /**
   * Plan-of-record estimate. When set, moving-time baselines come from estimate aid/finish
   * ETAs (plus distance interpolation for unmarked checkpoints). Dwell/delay/closed-actual
   * overlays still stack on later clocks.
   */
  pacingEstimate?: PacingEstimate;
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

async function requireRoomMember(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  roomId: string
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
  const entitlement = evaluateEntitlement(app, room, request.identity.sub);
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
 * Build moving-time anchors from an estimate: start=0, aid ETAs, finish=expectedFinish.
 * Unknown checkpoints interpolate by distance between neighboring anchors.
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

  // Prefer explicit finish checkpoint id when present.
  const finishCp =
    checkpoints.find((cp) => cp.id === "finish") ??
    [...checkpoints].sort((a, b) => checkpointDistanceMeters(b) - checkpointDistanceMeters(a))[0];
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
 * - Moving time from distance/pace (or estimate plan-of-record); a stop’s own dwell/delay/actual
 *   does not shift its arrival.
 * - Later arrivals add cumulative prior planned dwell + delay overrides, unless a **closed** visit
 *   exists at a prior stop — then that stop contributes `actualStopSeconds` instead
 *   (equiv. shift delta = actual − plannedDwell − delayOverride; no double-count of delay).
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
  const courseLengthMeters = resolveCourseLengthMeters(room, checkpoints);
  const ordered = [...checkpoints].sort(
    (a, b) => checkpointDistanceMeters(a) - checkpointDistanceMeters(b)
  );

  const estimateMoving =
    estimate !== undefined
      ? movingElapsedSecondsFromEstimate(estimate, ordered, courseLengthMeters)
      : undefined;

  let cumulativePriorDwellSeconds = 0;
  const stops: ScheduleStop[] = [];

  for (const checkpoint of ordered) {
    const overlay = overlays.get(checkpoint.id);
    const plannedDwellSeconds = Math.max(0, checkpoint.plannedStopSeconds ?? 0);
    const delayOverrideSeconds = overlay?.delayOverrideSeconds;
    const movingSeconds =
      estimateMoving?.get(checkpoint.id) ??
      Math.round(
        plannedElapsedSecondsForDistance({
          distanceMetersFromStart: checkpointDistanceMeters(checkpoint),
          plannedPaceSecondsPerKm,
          baselineTrack: course.baselineTrack,
          courseLengthMeters
        })
      );
    const elapsedSeconds = movingSeconds + cumulativePriorDwellSeconds;
    const notes = notesRefFromOverlay(overlay);
    const clockArrivalAt = new Date(raceStartMs + elapsedSeconds * 1000).toISOString();
    const stop: ScheduleStop = {
      id: `stop-${checkpoint.id}`,
      checkpointId: checkpoint.id,
      clockArrivalAt,
      elapsedSeconds,
      plannedDwellSeconds
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

    const plannedContribution =
      plannedDwellSeconds + (delayOverrideSeconds !== undefined ? delayOverrideSeconds : 0);
    const closedActual = lookupClosedActualSeconds(
      options?.closedActualStopSecondsByCheckpointId,
      checkpoint.id
    );
    // Closed visit replaces planned+delay (delta = actual − planned − delay). Incomplete → plan path.
    cumulativePriorDwellSeconds += closedActual !== undefined ? closedActual : plannedContribution;
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
    estimate: z.unknown().optional()
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

export async function raceRoomScheduleRoutes(app: FastifyInstance): Promise<void> {
  await initPacingEstimateStore(app.log);

  /**
   * Attach a pacing estimate as the room plan of record.
   * Ownership: only the athlete who created the estimate may attach it (401/403 otherwise).
   * Idempotent when the same estimate id is already attached.
   */
  app.put("/race-rooms/:roomId/pacing-estimate", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await requireCourseEditor(app, request, reply, roomId);
    if (!room) {
      return;
    }

    const parsedBody = attachPacingEstimateBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid pacing estimate attach payload", code: "invalid_payload" });
    }

    const athleteUserId = request.identity!.sub;
    let estimate: PacingEstimate;

    if (parsedBody.data.pacingEstimateId !== undefined) {
      const stored = await getPacingEstimateById(parsedBody.data.pacingEstimateId);
      if (!stored) {
        return reply.code(400).send({ error: "Unknown pacingEstimateId", code: "invalid_estimate_id" });
      }
      if (stored.athleteUserId !== athleteUserId) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      estimate = stored.estimate;
    } else {
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
        await savePacingEstimate(athleteUserId, estimate);
      }
    }

    // Idempotent: same id already plan of record → return current snapshot without rewrite churn.
    if (room.pacingEstimateId === estimate.id && room.pacingEstimate?.id === estimate.id) {
      const body: AttachResponse = {
        roomId,
        pacingEstimateId: estimate.id,
        estimate: room.pacingEstimate
      };
      return reply.send(body);
    }

    const updated: RaceRoom = {
      ...room,
      pacingEstimateId: estimate.id,
      pacingEstimate: estimate
    };
    await saveRaceRoom(updated);

    const body: AttachResponse = {
      roomId,
      pacingEstimateId: estimate.id,
      estimate
    };
    return reply.send(body);
  });

  app.get("/race-rooms/:roomId/schedule", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await requireRoomMember(app, request, reply, roomId);
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
      return reply.send(
        projectCrewScheduleSheet(room, {
          closedActualStopSecondsByCheckpointId: closedActuals,
          pacingEstimate: room.pacingEstimate
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "schedule_projection_failed";
      if (message === "checkpoint_distance_meters_from_start_required") {
        return reply.code(400).send({ error: "Checkpoint distances required for schedule" });
      }
      return reply.code(400).send({ error: "Unable to project schedule" });
    }
  });
}
