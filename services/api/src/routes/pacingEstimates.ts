/**
 * POST /pacing-estimates — history + room course → micro-model PacingEstimate.
 * Prefer `roomId` (loads route geometry from the race room). Legacy checkpoint-only
 * bodies still work with a sparse polyline from checkpoint centers.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  parseActivityHistoryRef,
  parseIso8601Utc,
  parsePacingEstimate,
  type ActivityHistoryRef,
  type RaceCourseCheckpoint
} from "@crewcue/contracts";
import type { CourseMetricPoint } from "@crewcue/map-core";
import {
  getActivityHistoryForAthlete,
  initActivityHistoryStore,
  listActivityHistoryForAthlete
} from "../lib/activityHistoryStore.js";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  PacingEstimateCourseError,
  estimatePacingMicroModelWithArtifacts
} from "../lib/pacingEstimate/index.js";
import {
  initPacingEstimateStore,
  savePacingEstimate
} from "../lib/pacingEstimateStore.js";
import { getRaceRoom, resolveRouteMetricPointsFromRaceRoomExport } from "./raceRooms.js";

const checkpointInput = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    distanceMetersFromStart: z.number().finite().nonnegative(),
    plannedStopSeconds: z.number().finite().nonnegative().optional(),
    stoppageRadiusMeters: z.number().finite().positive().optional(),
    slowdownThresholdRatio: z.number().finite().positive().optional(),
    tags: z.array(z.string()).optional()
  })
  .passthrough();

const estimateBody = z
  .object({
    /** Preferred: load course geometry + checkpoints from this race room. */
    roomId: z.string().min(1).optional(),
    raceStartAt: z.string().min(1).optional(),
    checkpoints: z.array(checkpointInput).min(2).optional(),
    /**
     * Optional subset of the athlete's history ids. When omitted, all stored
     * history for the authenticated athlete is used.
     */
    historyRefIds: z.array(z.string().min(1)).optional(),
    /** Optional determinism seed (defaults to fixture CI seed). */
    seed: z.string().min(1).optional(),
    /**
     * Optional athlete scope. When present must equal the authenticated user.
     */
    athleteUserId: z.string().min(1).optional()
  })
  .strict()
  .refine((b) => b.roomId !== undefined || (b.checkpoints !== undefined && b.raceStartAt !== undefined), {
    message: "roomId or (checkpoints + raceStartAt) required"
  });

async function resolveHistory(
  athleteUserId: string,
  historyRefIds: string[] | undefined
): Promise<{ ok: true; history: ActivityHistoryRef[] } | { ok: false; status: 404; error: string }> {
  if (historyRefIds === undefined) {
    const history = await listActivityHistoryForAthlete(athleteUserId);
    return { ok: true, history };
  }
  if (historyRefIds.length === 0) {
    return { ok: true, history: [] };
  }
  const history: ActivityHistoryRef[] = [];
  for (const id of historyRefIds) {
    const row = await getActivityHistoryForAthlete(athleteUserId, id);
    if (!row) {
      return { ok: false, status: 404, error: `Activity history not found: ${id}` };
    }
    history.push(parseActivityHistoryRef(row));
  }
  return { ok: true, history };
}

function routeFromCheckpoints(checkpoints: RaceCourseCheckpoint[]): CourseMetricPoint[] {
  return checkpoints.map((cp) => ({
    latitude: cp.latitude,
    longitude: cp.longitude,
    elevationMeters: null
  }));
}

export async function pacingEstimateRoutes(app: FastifyInstance): Promise<void> {
  await initActivityHistoryStore(app.log);
  await initPacingEstimateStore(app.log);

  app.post("/pacing-estimates", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsedBody = estimateBody.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid pacing estimate payload", code: "invalid_payload" });
    }

    const athleteUserId = request.identity.sub;
    if (parsedBody.data.athleteUserId !== undefined && parsedBody.data.athleteUserId !== athleteUserId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    let raceStartAt = parsedBody.data.raceStartAt;
    let checkpoints = parsedBody.data.checkpoints as RaceCourseCheckpoint[] | undefined;
    let routeMetricPoints: CourseMetricPoint[] | null = null;
    let courseLengthMeters: number | undefined;

    if (parsedBody.data.roomId) {
      const room = await getRaceRoom(parsedBody.data.roomId);
      if (!room) {
        return reply.code(404).send({ error: "Race room not found", code: "room_not_found" });
      }
      const membership = room.memberships.find((m) => m.userId === athleteUserId);
      if (!membership) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      if (!room.course || room.course.checkpoints.length < 2) {
        return reply.code(400).send({
          error: "Room course with at least two checkpoints is required",
          code: "course_incomplete"
        });
      }
      checkpoints = room.course.checkpoints;
      raceStartAt = raceStartAt ?? room.raceStartAt;
      if (!raceStartAt) {
        return reply.code(400).send({
          error: "raceStartAt required (set on room or request body)",
          code: "race_start_invalid"
        });
      }
      routeMetricPoints = resolveRouteMetricPointsFromRaceRoomExport(room);
      courseLengthMeters =
        room.course.derivedMetrics?.canonicalDistanceMeters ?? room.courseDistanceMeters;
      if (!routeMetricPoints) {
        return reply.code(400).send({
          error: "Room course route geometry is required for micro-model pacing",
          code: "course_incomplete"
        });
      }
    }

    if (!raceStartAt || !checkpoints) {
      return reply.code(400).send({ error: "Invalid pacing estimate payload", code: "invalid_payload" });
    }

    try {
      parseIso8601Utc(raceStartAt, "raceStartAt");
    } catch {
      return reply.code(400).send({
        error: "raceStartAt must be an ISO-8601 UTC string",
        code: "race_start_invalid"
      });
    }

    const historyResult = await resolveHistory(athleteUserId, parsedBody.data.historyRefIds);
    if (!historyResult.ok) {
      return reply.code(historyResult.status).send({ error: historyResult.error });
    }

    if (!routeMetricPoints) {
      routeMetricPoints = routeFromCheckpoints(checkpoints);
    }

    try {
      const artifacts = estimatePacingMicroModelWithArtifacts({
        raceStartAt,
        checkpoints,
        history: historyResult.history,
        seed: parsedBody.data.seed ?? DEFAULT_PACING_ESTIMATE_SEED,
        routeMetricPoints,
        courseLengthMeters
      });
      const parsed = parsePacingEstimate(artifacts.estimate);
      await savePacingEstimate(athleteUserId, parsed, artifacts.baselineTrack);
      return reply.code(200).send(parsed);
    } catch (err) {
      if (err instanceof PacingEstimateCourseError) {
        return reply.code(400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
}
