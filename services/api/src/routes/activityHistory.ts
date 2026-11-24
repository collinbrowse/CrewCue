/**
 * Athlete past-activity history ingest (W3-1).
 * GPX upload → ActivityHistoryRef; list/get for later W3-3 pacing.
 * `POST /activity-history/file` takes GPX, FIT or TCX exports (#652).
 * `POST /activity-history/preview` reads a file or .zip without saving, for the share-sheet preview;
 * `POST /activity-history/archive` imports every run in a .zip (run-import scope, slice 4).
 */
import { randomUUID } from "node:crypto";
import { parseActivityFile, simplifyPositions } from "@crewcue/map-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";
import {
  fingerprintGpxExternalId,
  GpxActivityParseError,
  parseGpxActivityMetrics
} from "../lib/gpxActivityHistory.js";
import { MAX_GPX_XML_CHARS } from "../lib/gpxLimits.js";
import {
  ActivityFileError,
  fingerprintActivityFile,
  MAX_ACTIVITY_FILE_BYTES,
  parseActivityFileMetrics
} from "../lib/activityFileHistory.js";
import { looksLikeZip, readZipEntries, ZipArchiveError, type ZipEntry } from "../lib/zipArchive.js";
import {
  getActivityHistoryForAthlete,
  initActivityHistoryStore,
  listActivityHistoryForAthlete,
  upsertActivityHistory
} from "../lib/activityHistoryStore.js";

const ingestGpxInput = z
  .object({
    gpxXml: z.string().min(1).max(MAX_GPX_XML_CHARS),
    /** Stable provider/upload id; defaults to a content fingerprint of gpxXml. */
    externalId: z.string().min(1).optional(),
    /**
     * Optional athlete scope. When present must equal the authenticated user.
     * Prevents writing another athlete's history (EC3).
     */
    athleteUserId: z.string().min(1).optional()
  })
  .strict();

/** Base64 length of the largest accepted file. */
const MAX_ACTIVITY_FILE_BASE64_CHARS = Math.ceil(MAX_ACTIVITY_FILE_BYTES / 3) * 4;

/** Exported watch file (.gpx, .fit, .tcx) as base64 (#652). */
const ingestFileInput = z
  .object({
    fileName: z.string().min(1).max(255),
    contentBase64: z.string().min(1),
    externalId: z.string().min(1).optional(),
    athleteUserId: z.string().min(1).optional()
  })
  .strict();

/** A shared or picked file for preview or archive import: one activity, or a .zip of them. */
const archiveInput = z
  .object({
    fileName: z.string().min(1).max(255),
    contentBase64: z.string().min(1)
  })
  .strict();

/** Largest .zip (or single file) the preview and archive routes take. Fits the 32 MB body as base64. */
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_BASE64_CHARS = Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4;
/** Runs one .zip may hold (a year of daily runs, with room). */
export const MAX_ARCHIVE_ENTRIES = 500;
/** Unpacked size cap across a .zip. */
export const MAX_ARCHIVE_UNPACKED_BYTES = 200 * 1024 * 1024;
/** Points in a preview's route line. */
export const PREVIEW_TRACK_POINTS = 200;
const ACTIVITY_EXTENSIONS = /\.(gpx|fit|tcx)$/i;

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

/**
 * What clients see. The grade profile (about 60 grade steps per run) is for the pace model only,
 * so it stays out of list and ingest responses to keep phone payloads small.
 */
function toClientRef(ref: ActivityHistoryRef): ActivityHistoryRef {
  const { gradeProfile: _gradeProfile, ...rest } = ref;
  return rest;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

/** One activity file → a history row to store. @throws {ActivityFileError} */
function refFromFile(bytes: Uint8Array, fileName: string, externalId?: string): ActivityHistoryRef {
  const metrics = parseActivityFileMetrics(bytes, fileName);
  const ingestedAt = toIsoNow();
  return parseActivityHistoryRef({
    id: randomUUID(),
    source: metrics.source,
    externalId: externalId ?? fingerprintActivityFile(bytes),
    recordedAt: metrics.recordedAt ?? ingestedAt,
    ingestedAt,
    distanceMeters: metrics.distanceMeters,
    ...(metrics.elapsedSeconds !== undefined ? { elapsedSeconds: metrics.elapsedSeconds } : {}),
    ...(metrics.elevationGainMeters !== undefined ? { elevationGainMeters: metrics.elevationGainMeters } : {}),
    ...(metrics.slowdownSlope !== undefined ? { slowdownSlope: metrics.slowdownSlope } : {}),
    ...(metrics.gradeProfile !== undefined ? { gradeProfile: metrics.gradeProfile } : {})
  });
}

type ArchiveFile = { fileName: string; bytes: Uint8Array };
type Unreadable = { fileName: string; error: string };

/**
 * The activity files in an upload: the file itself, or each .gpx/.fit/.tcx in a .zip. Other files
 * in a .zip are listed as unreadable so the runner sees what was skipped.
 * @throws {ZipArchiveError}
 */
function filesInUpload(fileName: string, bytes: Uint8Array): { files: ArchiveFile[]; unreadable: Unreadable[] } {
  if (!looksLikeZip(bytes)) {
    return { files: [{ fileName, bytes }], unreadable: [] };
  }
  const entries: ZipEntry[] = readZipEntries(bytes, {
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxEntryBytes: MAX_ACTIVITY_FILE_BYTES,
    maxTotalBytes: MAX_ARCHIVE_UNPACKED_BYTES
  });
  const files: ArchiveFile[] = [];
  const unreadable: Unreadable[] = [];
  for (const entry of entries) {
    if (ACTIVITY_EXTENSIONS.test(entry.name)) {
      files.push({ fileName: entry.name, bytes: entry.bytes });
    } else {
      unreadable.push({ fileName: entry.name, error: "Not a .gpx, .fit or .tcx file." });
    }
  }
  return { files, unreadable };
}

function decodeArchiveBody(
  body: unknown
): { ok: true; fileName: string; bytes: Uint8Array } | { ok: false; status: 400 | 413; error: string; code?: string } {
  const parsed = archiveInput.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid activity file payload" };
  }
  if (parsed.data.contentBase64.length > MAX_ARCHIVE_BASE64_CHARS) {
    return { ok: false, status: 413, error: "The file is larger than 20 MB. Export fewer runs at a time.", code: "file_too_large" };
  }
  return { ok: true, fileName: parsed.data.fileName, bytes: new Uint8Array(Buffer.from(parsed.data.contentBase64, "base64")) };
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
    return reply.code(result.created ? 201 : 200).send(toClientRef(result.ref));
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
        : {}),
      ...(metrics.slowdownSlope !== undefined ? { slowdownSlope: metrics.slowdownSlope } : {}),
      ...(metrics.gradeProfile !== undefined ? { gradeProfile: metrics.gradeProfile } : {})
    };

    const validated = parseActivityHistoryRef(candidate);
    const result = await upsertActivityHistory(athleteUserId, validated);
    return reply.code(result.created ? 201 : 200).send(toClientRef(result.ref));
  });

  app.post("/activity-history/file", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsedBody = ingestFileInput.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid activity file payload" });
    }

    const athleteUserId = request.identity.sub;
    if (parsedBody.data.athleteUserId !== undefined && parsedBody.data.athleteUserId !== athleteUserId) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (parsedBody.data.contentBase64.length > MAX_ACTIVITY_FILE_BASE64_CHARS) {
      return reply
        .code(413)
        .send({ error: "The file is larger than 10 MB. Export a single activity.", code: "file_too_large" });
    }

    const bytes = new Uint8Array(Buffer.from(parsedBody.data.contentBase64, "base64"));
    let ref: ActivityHistoryRef;
    try {
      ref = refFromFile(bytes, parsedBody.data.fileName, parsedBody.data.externalId);
    } catch (err) {
      if (err instanceof ActivityFileError) {
        return reply.code(err.code === "file_too_large" ? 413 : 400).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const result = await upsertActivityHistory(athleteUserId, ref);
    return reply.code(result.created ? 201 : 200).send(toClientRef(result.ref));
  });

  /** Read a file or .zip without saving: each run's stats and route line, and whether it's already imported. */
  app.post("/activity-history/preview", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const decoded = decodeArchiveBody(request.body);
    if (!decoded.ok) {
      return reply.code(decoded.status).send({ error: decoded.error, ...(decoded.code ? { code: decoded.code } : {}) });
    }
    let upload;
    try {
      upload = filesInUpload(decoded.fileName, decoded.bytes);
    } catch (err) {
      if (err instanceof ZipArchiveError) return reply.code(400).send({ error: err.message, code: "file_corrupt" });
      throw err;
    }
    const stored = new Set(
      (await listActivityHistoryForAthlete(request.identity.sub)).map((ref) => `${ref.source}|${ref.externalId}`)
    );
    const runs: unknown[] = [];
    const unreadable = [...upload.unreadable];
    for (const file of upload.files) {
      try {
        const ref = refFromFile(file.bytes, file.fileName);
        const parsed = parseActivityFile(file.bytes, file.fileName);
        const track = simplifyPositions(
          parsed.points.map((point) => [point.longitude, point.latitude] as [number, number]),
          PREVIEW_TRACK_POINTS
        ).map(([lon, lat]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
        runs.push({
          fileName: file.fileName,
          source: ref.source,
          recordedAt: ref.recordedAt,
          distanceMeters: ref.distanceMeters,
          ...(ref.elapsedSeconds !== undefined ? { elapsedSeconds: ref.elapsedSeconds } : {}),
          ...(ref.elevationGainMeters !== undefined ? { elevationGainMeters: ref.elevationGainMeters } : {}),
          track,
          alreadyImported: stored.has(`${ref.source}|${ref.externalId}`)
        });
      } catch (err) {
        if (err instanceof ActivityFileError) {
          unreadable.push({ fileName: file.fileName, error: err.message });
          continue;
        }
        throw err;
      }
    }
    return reply.code(200).send({ runs, unreadable });
  });

  /** Import every run in a .zip (or one file). Same rows and dedupe as `/activity-history/file`. */
  app.post("/activity-history/archive", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const decoded = decodeArchiveBody(request.body);
    if (!decoded.ok) {
      return reply.code(decoded.status).send({ error: decoded.error, ...(decoded.code ? { code: decoded.code } : {}) });
    }
    let upload;
    try {
      upload = filesInUpload(decoded.fileName, decoded.bytes);
    } catch (err) {
      if (err instanceof ZipArchiveError) return reply.code(400).send({ error: err.message, code: "file_corrupt" });
      throw err;
    }
    const athleteUserId = request.identity.sub;
    const items: ActivityHistoryRef[] = [];
    const unreadable = [...upload.unreadable];
    let saved = 0;
    let duplicates = 0;
    for (const file of upload.files) {
      let ref: ActivityHistoryRef;
      try {
        ref = refFromFile(file.bytes, file.fileName);
      } catch (err) {
        if (err instanceof ActivityFileError) {
          unreadable.push({ fileName: file.fileName, error: err.message });
          continue;
        }
        throw err;
      }
      const result = await upsertActivityHistory(athleteUserId, ref);
      if (result.created) saved += 1;
      else duplicates += 1;
      items.push(toClientRef(result.ref));
    }
    return reply.code(saved > 0 ? 201 : 200).send({ saved, duplicates, unreadable, items });
  });

  app.get("/activity-history", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const items = await listActivityHistoryForAthlete(request.identity.sub);
    return reply.code(200).send({ items: items.map(toClientRef) });
  });

  app.get<{ Params: { historyId: string } }>("/activity-history/:historyId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const ref = await getActivityHistoryForAthlete(request.identity.sub, request.params.historyId);
    if (!ref) {
      return reply.code(404).send({ error: "Activity history not found" });
    }
    return reply.code(200).send(toClientRef(ref));
  });
}
