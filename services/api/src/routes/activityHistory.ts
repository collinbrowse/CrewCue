/**
 * Athlete past-activity history ingest (W3-1).
 * GPX upload → ActivityHistoryRef; list/get for later W3-3 pacing.
 * `POST /activity-history/file` takes GPX, FIT or TCX exports (#652).
 * `POST /activity-history/preview` reads a file or .zip without saving, for the share-sheet preview;
 * `POST /activity-history/archive` imports every run in a .zip (run-import scope, slice 4).
 * `DELETE /activity-history/:historyId` removes one of the caller's runs from their pacing history.
 */
import { randomUUID } from "node:crypto";
import { isFootActivity, parseActivityFile, simplifyPositions } from "@crewcue/map-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";
import { fingerprintGpxExternalId, GpxActivityParseError } from "../lib/gpxActivityHistory.js";
import { MAX_GPX_XML_CHARS } from "../lib/gpxLimits.js";
import {
  ACTIVITY_FILE_SOURCES,
  ActivityFileError,
  fingerprintActivityFile,
  gunzipActivityFile,
  MAX_ACTIVITY_FILE_BYTES,
  parseActivityFileMetrics,
  type ParsedActivityFileMetrics
} from "../lib/activityFileHistory.js";
import { parseUploadInWorker, UploadParseLimitError } from "../lib/uploadParse.js";
import { looksLikeZip, zipEntries, ZipArchiveError } from "../lib/zipArchive.js";
import { startUploadJob, uploadJobFor } from "../lib/uploadJobs.js";
import {
  deleteActivityHistoryEntry,
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
/**
 * Raw `.zip` uploads (`/activity-history/upload`): a whole watch-app export, read one file at a time.
 * A COROS bulk export of several years is about 130 MB zipped.
 */
export const MAX_RAW_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_RAW_UPLOAD_ENTRIES = 5000;
export const MAX_RAW_UPLOAD_UNPACKED_BYTES = 1024 * 1024 * 1024;
/**
 * A multi-run upload keeps runs from this many days before its newest run; older ones are counted,
 * not imported. Counting from the newest run (not today) keeps an export made a while ago useful.
 */
export const BULK_WINDOW_DAYS = 365;
/** Unreadable files listed by name in a response; the rest are only counted. */
export const MAX_UNREADABLE_LISTED = 50;
/** A background upload lets the event loop run at least this often (ms). */
const UPLOAD_YIELD_EVERY_MS = 20;
/** Activity files in a .zip, plain or gzipped (Strava's bulk export gzips each original FIT and TCX). */
const ACTIVITY_EXTENSIONS = /\.(gpx|fit|tcx)(\.gz)?$/i;

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
  return refFromMetrics(parseActivityFileMetrics(bytes, fileName), bytes, externalId);
}

function refFromMetrics(metrics: ParsedActivityFileMetrics, bytes: Uint8Array, externalId?: string): ActivityHistoryRef {
  const ingestedAt = toIsoNow();
  return parseActivityHistoryRef({
    id: randomUUID(),
    source: metrics.source,
    externalId: externalId ?? fingerprintActivityFile(bytes),
    recordedAt: metrics.recordedAt ?? ingestedAt,
    ingestedAt,
    ...(metrics.name !== undefined ? { name: metrics.name } : {}),
    distanceMeters: metrics.distanceMeters,
    ...(metrics.elapsedSeconds !== undefined ? { elapsedSeconds: metrics.elapsedSeconds } : {}),
    ...(metrics.elevationGainMeters !== undefined ? { elevationGainMeters: metrics.elevationGainMeters } : {}),
    ...(metrics.slowdownSlope !== undefined ? { slowdownSlope: metrics.slowdownSlope } : {}),
    ...(metrics.gradeProfile !== undefined ? { gradeProfile: metrics.gradeProfile } : {})
  });
}

type ArchiveFile = { fileName: string; bytes: Uint8Array };
type Unreadable = { fileName: string; error: string };
type UploadLimits = { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number };

const JSON_UPLOAD_LIMITS: UploadLimits = {
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxEntryBytes: MAX_ACTIVITY_FILE_BYTES,
  maxTotalBytes: MAX_ARCHIVE_UNPACKED_BYTES
};
const RAW_UPLOAD_LIMITS: UploadLimits = {
  maxEntries: MAX_RAW_UPLOAD_ENTRIES,
  maxEntryBytes: MAX_ACTIVITY_FILE_BYTES,
  maxTotalBytes: MAX_RAW_UPLOAD_UNPACKED_BYTES
};

/**
 * The activity files in an upload, one at a time: the file itself, or each .gpx/.fit/.tcx in a
 * .zip. Other files in a .zip come back with `bytes: null` so they can be counted.
 * @throws {ZipArchiveError}
 */
function* filesInUpload(
  fileName: string,
  bytes: Uint8Array,
  limits: UploadLimits
): Generator<ArchiveFile | { fileName: string; bytes: null; error?: string }> {
  if (!looksLikeZip(bytes)) {
    yield { fileName, bytes };
    return;
  }
  for (const entry of zipEntries(bytes, limits)) {
    const isActivity = ACTIVITY_EXTENSIONS.test(entry.name);
    if (isActivity && entry.bytes === null) {
      yield { fileName: entry.name, bytes: null, error: "The file is larger than 10 MB. Export a single activity." };
    } else if (isActivity && entry.bytes) {
      yield { fileName: entry.name, bytes: entry.bytes };
    } else {
      yield { fileName: entry.name, bytes: null };
    }
  }
}

/** What an upload holds, after the sport and (for multi-run uploads) one-year filters. */
type UploadSummary = {
  runs: Array<{ fileName: string; ref: ActivityHistoryRef; track?: number[][] }>;
  unreadable: Unreadable[];
  skipped: { older: number; notRun: number; unreadable: number };
};

/**
 * Read an upload. `withProfiles` builds the full row (grade profile included) for import; preview
 * reads stats only, which is several times faster on a large export.
 * @throws {ZipArchiveError}
 */
async function readUpload(
  fileName: string,
  bytes: Uint8Array,
  limits: UploadLimits,
  withProfiles: boolean,
  yieldNow: () => Promise<void> = async () => {}
): Promise<UploadSummary> {
  const isZip = looksLikeZip(bytes);
  const parsedRuns: Array<{ fileName: string; ref: ActivityHistoryRef; track?: number[][]; startMs: number | null }> = [];
  const unreadable: Unreadable[] = [];
  const skipped = { older: 0, notRun: 0, unreadable: 0 };
  const unread = (row: Unreadable) => {
    skipped.unreadable += 1;
    if (unreadable.length < MAX_UNREADABLE_LISTED) unreadable.push(row);
  };
  let lastYieldMs = Date.now();
  for (const file of filesInUpload(fileName, bytes, limits)) {
    // Parsing is synchronous CPU work: give other requests (location pings) a turn every few files.
    if (Date.now() - lastYieldMs >= UPLOAD_YIELD_EVERY_MS) {
      await yieldNow();
      lastYieldMs = Date.now();
    }
    if (file.bytes === null) {
      unread({ fileName: file.fileName, error: ("error" in file && file.error) || "Not a .gpx, .fit or .tcx file." });
      continue;
    }
    let parsed;
    let activity: { bytes: Uint8Array; fileName: string };
    try {
      // A gzipped activity (`123.fit.gz` from a Strava export) is read as the file inside. Its row's
      // fingerprint is the unpacked file's, so it dedupes against the same run imported plain.
      activity = gunzipActivityFile(file.bytes, file.fileName);
      parsed = parseActivityFile(activity.bytes, activity.fileName);
    } catch (err) {
      if (err instanceof ActivityFileError) {
        unread({ fileName: file.fileName, error: err.message });
        continue;
      }
      throw err;
    }
    if (!isFootActivity(parsed.sport)) {
      skipped.notRun += 1;
      if (!isZip) unread({ fileName: file.fileName, error: "This activity isn't a run or hike. Choose a run or hike." });
      continue;
    }
    const ref = withProfiles
      ? refFromFile(activity.bytes, activity.fileName)
      : parseActivityHistoryRef({
          id: randomUUID(),
          source: ACTIVITY_FILE_SOURCES[parsed.format],
          externalId: fingerprintActivityFile(activity.bytes),
          recordedAt: new Date(parsed.startTimestampMs ?? Date.now()).toISOString(),
          ingestedAt: toIsoNow(),
          ...(parsed.name ? { name: parsed.name } : {}),
          distanceMeters: parsed.distanceMeters,
          ...(parsed.elapsedSeconds !== null ? { elapsedSeconds: parsed.elapsedSeconds } : {}),
          ...(parsed.elevationGainMeters !== null ? { elevationGainMeters: parsed.elevationGainMeters } : {})
        });
    const track = simplifyPositions(
      parsed.points.map((point) => [point.longitude, point.latitude] as [number, number]),
      PREVIEW_TRACK_POINTS
    ).map(([lon, lat]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
    parsedRuns.push({ fileName: file.fileName, ref, track, startMs: parsed.startTimestampMs });
  }
  // One run is imported whatever its date; a bulk upload keeps the last year.
  let runs = parsedRuns;
  if (parsedRuns.length > 1) {
    const newest = Math.max(...parsedRuns.map((run) => run.startMs ?? 0));
    const since = newest - BULK_WINDOW_DAYS * 86_400_000;
    runs = parsedRuns.filter((run) => run.startMs === null || run.startMs >= since);
    skipped.older = parsedRuns.length - runs.length;
  }
  runs.sort((a, b) => b.ref.recordedAt.localeCompare(a.ref.recordedAt));
  // The route line only helps a single-run preview; thousands of them would bloat the response.
  if (runs.length !== 1) for (const run of runs) delete run.track;
  return {
    runs: runs.map(({ fileName: name, ref, track }) => ({ fileName: name, ref, ...(track ? { track } : {}) })),
    unreadable,
    skipped
  };
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
  // Raw bodies for `/activity-history/upload` (bulk import). Scoped to this plugin.
  app.addContentTypeParser(
    ["application/zip", "application/octet-stream", "application/x-zip-compressed"],
    { parseAs: "buffer", bodyLimit: MAX_RAW_UPLOAD_BYTES },
    (_request, body, done) => done(null, body)
  );

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
      metrics = await parseUploadInWorker({ kind: "gpxActivity", gpxXml: parsedBody.data.gpxXml });
    } catch (err) {
      if (err instanceof GpxActivityParseError) {
        return reply.code(400).send({ error: err.message, code: err.code });
      }
      if (err instanceof UploadParseLimitError) {
        return reply.code(422).send({ error: err.message, code: err.code });
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
      const activity = gunzipActivityFile(bytes, parsedBody.data.fileName);
      const metrics = await parseUploadInWorker({
        kind: "activityFile",
        bytes: activity.bytes,
        fileName: activity.fileName
      });
      ref = refFromMetrics(metrics, activity.bytes, parsedBody.data.externalId);
    } catch (err) {
      if (err instanceof ActivityFileError) {
        return reply.code(err.code === "file_too_large" ? 413 : 400).send({ error: err.message, code: err.code });
      }
      if (err instanceof UploadParseLimitError) {
        return reply.code(422).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const result = await upsertActivityHistory(athleteUserId, ref);
    return reply.code(result.created ? 201 : 200).send(toClientRef(result.ref));
  });

  async function previewResponse(athleteUserId: string, upload: UploadSummary) {
    const stored = new Set(
      (await listActivityHistoryForAthlete(athleteUserId)).map((ref) => `${ref.source}|${ref.externalId}`)
    );
    return {
      runs: upload.runs.map(({ fileName, ref, track }) => ({
        fileName,
        source: ref.source,
        ...(ref.name !== undefined ? { name: ref.name } : {}),
        recordedAt: ref.recordedAt,
        distanceMeters: ref.distanceMeters,
        ...(ref.elapsedSeconds !== undefined ? { elapsedSeconds: ref.elapsedSeconds } : {}),
        ...(ref.elevationGainMeters !== undefined ? { elevationGainMeters: ref.elevationGainMeters } : {}),
        track: track ?? [],
        alreadyImported: stored.has(`${ref.source}|${ref.externalId}`)
      })),
      unreadable: upload.unreadable,
      skipped: upload.skipped
    };
  }

  async function importResponse(athleteUserId: string, upload: UploadSummary, throwIfWritesStopped: () => void = () => {}) {
    const items: ActivityHistoryRef[] = [];
    let saved = 0;
    let duplicates = 0;
    for (const { ref } of upload.runs) {
      throwIfWritesStopped();
      const result = await upsertActivityHistory(athleteUserId, ref);
      if (result.created) saved += 1;
      else duplicates += 1;
      items.push(toClientRef(result.ref));
    }
    return { saved, duplicates, unreadable: upload.unreadable, skipped: upload.skipped, items };
  }

  /** Read a file or .zip without saving: each run's stats, whether it's already imported, and what was skipped. */
  app.post("/activity-history/preview", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const decoded = decodeArchiveBody(request.body);
    if (!decoded.ok) {
      return reply.code(decoded.status).send({ error: decoded.error, ...(decoded.code ? { code: decoded.code } : {}) });
    }
    try {
      const upload = await readUpload(decoded.fileName, decoded.bytes, JSON_UPLOAD_LIMITS, false);
      return reply.code(200).send(await previewResponse(request.identity.sub, upload));
    } catch (err) {
      if (err instanceof ZipArchiveError) return reply.code(400).send({ error: err.message, code: "file_corrupt" });
      throw err;
    }
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
    try {
      const upload = await readUpload(decoded.fileName, decoded.bytes, JSON_UPLOAD_LIMITS, true);
      const body = await importResponse(request.identity.sub, upload);
      return reply.code(body.saved > 0 ? 201 : 200).send(body);
    } catch (err) {
      if (err instanceof ZipArchiveError) return reply.code(400).send({ error: err.message, code: "file_corrupt" });
      throw err;
    }
  });

  /**
   * Raw upload of a whole export (bulk import): the file's bytes as the body (`application/zip` or
   * `application/octet-stream`), `?fileName=` and `?mode=preview|import`. Up to 200 MB and 5,000 files.
   * Returns 202 `{ jobId }` at once; `GET /activity-history/upload-jobs/:jobId` has the result,
   * which is the same body and status the preview and archive routes send.
   */
  app.post<{ Querystring: { fileName?: string; mode?: string } }>(
    "/activity-history/upload",
    { bodyLimit: MAX_RAW_UPLOAD_BYTES },
    async (request, reply) => {
      if (!request.identity) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const athleteUserId = request.identity.sub;
      const body = request.body;
      const fileName = (request.query.fileName ?? "").trim() || "activity";
      const mode = request.query.mode === "import" ? "import" : request.query.mode === "preview" ? "preview" : null;
      if (!Buffer.isBuffer(body) || body.length === 0 || mode === null || fileName.length > 255) {
        return reply.code(400).send({ error: "Invalid activity upload" });
      }
      const bytes = new Uint8Array(body);
      const jobId = startUploadJob(
        athleteUserId,
        async ({ yieldNow, throwIfWritesStopped }) => {
          const upload = await readUpload(fileName, bytes, RAW_UPLOAD_LIMITS, mode === "import", yieldNow);
          if (mode === "preview") {
            return { status: 200, body: await previewResponse(athleteUserId, upload) };
          }
          const result = await importResponse(athleteUserId, upload, throwIfWritesStopped);
          return { status: result.saved > 0 ? 201 : 200, body: result };
        },
        (err) => {
          if (err instanceof ZipArchiveError) return { status: 400, body: { error: err.message, code: "file_corrupt" } };
          request.log.error({ err }, "activity upload job failed");
          return { status: 500, body: { error: "Internal Server Error" } };
        }
      );
      return reply.code(202).send({ jobId });
    }
  );

  /**
   * A bulk upload's progress: 202 `{ state: "running" }` while it reads, then the finished
   * preview or import with its own status. 404 once it's gone (expired, a restart, someone else's).
   */
  app.get<{ Params: { jobId: string } }>("/activity-history/upload-jobs/:jobId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const job = uploadJobFor(request.identity.sub, request.params.jobId);
    if (!job) {
      return reply.code(404).send({ error: "Upload not found. Share the file again.", code: "upload_not_found" });
    }
    if (job.state === "running") return reply.code(202).send({ state: "running" });
    return reply.code(job.status).send(job.body);
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

  /** Owner-only. Another athlete's id reads as 404, the same as an unknown one. */
  app.delete<{ Params: { historyId: string } }>("/activity-history/:historyId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const removed = await deleteActivityHistoryEntry(request.identity.sub, request.params.historyId);
    if (!removed) {
      return reply.code(404).send({ error: "Activity history not found" });
    }
    return reply.code(204).send();
  });
}
