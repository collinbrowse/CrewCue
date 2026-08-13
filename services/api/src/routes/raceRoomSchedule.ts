import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CrewScheduleSheet,
  RaceCourseCheckpoint,
  RaceRoom,
  RaceRoomStopPlan,
  ScheduleStop,
  ScheduleStopNotesRef
} from "@crewcue/contracts";
import { plannedElapsedSecondsForDistance } from "../lib/raceProjection.js";
import { evaluateEntitlement, getRaceRoom } from "./raceRooms.js";

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

/**
 * Build a crew schedule sheet from live checkpoints + stop-plan overlays.
 * Clock policy: moving time from distance/pace (or baseline); later arrivals add cumulative
 * prior planned dwell + delay overrides. A stop’s own dwell/delay does not shift its arrival.
 */
export function projectCrewScheduleSheet(room: RaceRoom): CrewScheduleSheet {
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

  const overlays = overlayByCheckpointId(room);
  const courseLengthMeters = resolveCourseLengthMeters(room, checkpoints);
  const ordered = [...checkpoints].sort(
    (a, b) => checkpointDistanceMeters(a) - checkpointDistanceMeters(b)
  );

  let cumulativePriorDwellSeconds = 0;
  const stops: ScheduleStop[] = [];

  for (const checkpoint of ordered) {
    const overlay = overlays.get(checkpoint.id);
    const plannedDwellSeconds = Math.max(0, checkpoint.plannedStopSeconds ?? 0);
    const delayOverrideSeconds = overlay?.delayOverrideSeconds;
    const movingSeconds = Math.round(
      plannedElapsedSecondsForDistance({
        distanceMetersFromStart: checkpointDistanceMeters(checkpoint),
        plannedPaceSecondsPerKm,
        baselineTrack: course.baselineTrack,
        courseLengthMeters
      })
    );
    const elapsedSeconds = movingSeconds + cumulativePriorDwellSeconds;
    const notes = notesRefFromOverlay(overlay);
    const stop: ScheduleStop = {
      id: `stop-${checkpoint.id}`,
      checkpointId: checkpoint.id,
      clockArrivalAt: new Date(raceStartMs + elapsedSeconds * 1000).toISOString(),
      elapsedSeconds,
      plannedDwellSeconds
    };
    if (delayOverrideSeconds !== undefined) {
      stop.delayOverrideSeconds = delayOverrideSeconds;
    }
    if (notes) {
      stop.notes = notes;
    }
    stops.push(stop);

    cumulativePriorDwellSeconds +=
      plannedDwellSeconds + (delayOverrideSeconds !== undefined ? delayOverrideSeconds : 0);
  }

  return {
    roomId: room.id,
    raceStartAt: new Date(raceStartMs).toISOString(),
    stops
  };
}

export async function raceRoomScheduleRoutes(app: FastifyInstance): Promise<void> {
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

    try {
      return reply.send(projectCrewScheduleSheet(room));
    } catch (error) {
      const message = error instanceof Error ? error.message : "schedule_projection_failed";
      if (message === "checkpoint_distance_meters_from_start_required") {
        return reply.code(400).send({ error: "Checkpoint distances required for schedule" });
      }
      return reply.code(400).send({ error: "Unable to project schedule" });
    }
  });
}
