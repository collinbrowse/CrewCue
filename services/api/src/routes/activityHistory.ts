/**
 * Athlete past-activity history ingest (W3-1).
 * GPX upload → ActivityHistoryRef; list/get for later W3-3 pacing.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";
import {
  fingerprintGpxExternalId,
  GpxActivityParseError,
  parseGpxActivityMetrics
} from "../lib/gpxActivityHistory.js";
import {
  getActivityHistoryForAthlete,
  initActivityHistoryStore,
  listActivityHistoryForAthlete,
  upsertActivityHistory
} from "../lib/activityHistoryStore.js";

const ingestGpxInput = z
  .object({
    gpxXml: z.string().min(1),
    /** Stable provider/upload id; defaults to a content fingerprint of gpxXml. */
    externalId: z.string().min(1).optional(),
    /**
     * Optional athlete scope. When present must equal the authenticated user.
     * Prevents writing another athlete's history (EC3).
     */
    athleteUserId: z.string().min(1).optional()
  })
  .strict();

/** Metrics-only ingest (preferred for mobile — avoids multi‑MB JSON GPX bodies). */
const ingestMetricsInput = z
  .object({
    /** Stable upload fingerprint / provider id (idempotency with source). */
    externalId: z.string().min(1),
    recordedAt: z.string().min(1).optional(),
    distanceMeters: z.number().positive(),
    elapsedSeconds: z.number().positive().optional(),
    elevationGainMeters: z.number().nonnegative().optional(),
    athleteUserId: z.string().min(1).optional()
  })
  .strict();

function toIsoNow(): string {
  return new Date().toISOString();
}

export async function activityHistoryRoutes(app: FastifyInstance): Promise<void> {
  await initActivityHistoryStore(app.log);

  app.post("/activity-history", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsedBody = ingestMetricsInput.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid activity history metrics payload" });
    }

    const athleteUserId = request.identity.sub;
    if (parsedBody.data.athleteUserId !== undefined && parsedBody.data.athleteUserId !== athleteUserId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const ingestedAt = toIsoNow();
    const recordedAt = parsedBody.data.recordedAt ?? ingestedAt;
    const candidate: ActivityHistoryRef = {
      id: randomUUID(),
      source: "gpx_upload",
      externalId: parsedBody.data.externalId,
      recordedAt,
      ingestedAt,
      distanceMeters: parsedBody.data.distanceMeters,
      ...(parsedBody.data.elapsedSeconds !== undefined
        ? { elapsedSeconds: parsedBody.data.elapsedSeconds }
        : {}),
      ...(parsedBody.data.elevationGainMeters !== undefined
        ? { elevationGainMeters: parsedBody.data.elevationGainMeters }
        : {})
    };

    const validated = parseActivityHistoryRef(candidate);
    const result = await upsertActivityHistory(athleteUserId, validated);
    return reply.code(result.created ? 201 : 200).send(result.ref);
  });

  app.post("/activity-history/gpx", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsedBody = ingestGpxInput.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid activity history ingest payload" });
    }

    const athleteUserId = request.identity.sub;
    if (parsedBody.data.athleteUserId !== undefined && parsedBody.data.athleteUserId !== athleteUserId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    let metrics;
    try {
      metrics = parseGpxActivityMetrics(parsedBody.data.gpxXml);
    } catch (err) {
      if (err instanceof GpxActivityParseError) {
        return reply.code(400).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const ingestedAt = toIsoNow();
    const recordedAt = metrics.recordedAt ?? ingestedAt;
    const externalId = parsedBody.data.externalId ?? fingerprintGpxExternalId(parsedBody.data.gpxXml);

    const candidate: ActivityHistoryRef = {
      id: randomUUID(),
      source: "gpx_upload",
      externalId,
      recordedAt,
      ingestedAt,
      distanceMeters: metrics.distanceMeters,
      ...(metrics.elapsedSeconds !== undefined ? { elapsedSeconds: metrics.elapsedSeconds } : {}),
      ...(metrics.elevationGainMeters !== undefined
        ? { elevationGainMeters: metrics.elevationGainMeters }
        : {})
    };

    const validated = parseActivityHistoryRef(candidate);
    const result = await upsertActivityHistory(athleteUserId, validated);
    return reply.code(result.created ? 201 : 200).send(result.ref);
  });

  app.get("/activity-history", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const items = await listActivityHistoryForAthlete(request.identity.sub);
    return reply.code(200).send({ items });
  });

  app.get<{ Params: { historyId: string } }>("/activity-history/:historyId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const ref = await getActivityHistoryForAthlete(request.identity.sub, request.params.historyId);
    if (!ref) {
      return reply.code(404).send({ error: "Activity history not found" });
    }
    return reply.code(200).send(ref);
  });
}
