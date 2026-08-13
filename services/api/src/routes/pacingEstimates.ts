/**
 * POST /pacing-estimates — history + course → PacingEstimate (W3-3).
 * Uses athlete activity-history store + deterministic estimator (no live LLM).
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
import {
  getActivityHistoryForAthlete,
  initActivityHistoryStore,
  listActivityHistoryForAthlete
} from "../lib/activityHistoryStore.js";
import {
  DEFAULT_PACING_ESTIMATE_SEED,
  PacingEstimateCourseError,
  deterministicPacingEstimator
} from "../lib/pacingEstimate/index.js";
import {
  initPacingEstimateStore,
  savePacingEstimate
} from "../lib/pacingEstimateStore.js";

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
    raceStartAt: z.string().min(1),
    checkpoints: z.array(checkpointInput).min(2),
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
  .strict();

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

    try {
      parseIso8601Utc(parsedBody.data.raceStartAt, "raceStartAt");
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

    const checkpoints = parsedBody.data.checkpoints as RaceCourseCheckpoint[];

    try {
      const estimate = deterministicPacingEstimator.estimate({
        raceStartAt: parsedBody.data.raceStartAt,
        checkpoints,
        history: historyResult.history,
        seed: parsedBody.data.seed ?? DEFAULT_PACING_ESTIMATE_SEED
      });
      const parsed = parsePacingEstimate(estimate);
      await savePacingEstimate(athleteUserId, parsed);
      return reply.code(200).send(parsed);
    } catch (err) {
      if (err instanceof PacingEstimateCourseError) {
        return reply.code(400).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
}
