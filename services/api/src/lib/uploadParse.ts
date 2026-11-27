/**
 * Uploaded route and activity files are parsed in a worker thread, so a large or unusual file
 * never holds up the event loop that serves other requests (location pings, health checks).
 * Each parse gets its own short-lived worker and a time limit; past the limit the worker is
 * stopped and the caller gets {@link UploadParseLimitError}.
 */
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { ActivityFileError, type ActivityFileErrorCode } from "@crewcue/map-core";
import type { ParsedActivityFileMetrics } from "./activityFileHistory.js";
import type { CoursePreview } from "./coursePreview.js";
import { GpxActivityParseError, type GpxActivityParseErrorCode, type ParsedGpxActivityMetrics } from "./gpxActivityHistory.js";

export type UploadParseTask =
  | { kind: "gpxActivity"; gpxXml: string }
  | { kind: "activityFile"; bytes: Uint8Array; fileName: string }
  | { kind: "coursePreview"; gpxXml: string; courseFileName: string };

type UploadParseResults = {
  gpxActivity: ParsedGpxActivityMetrics;
  activityFile: ParsedActivityFileMetrics;
  coursePreview: CoursePreview;
};

/** What the worker posts back. */
export type UploadParseMessage =
  | { ok: true; value: unknown }
  | { ok: false; error: { name: string; message: string; code?: string } };

export type UploadParseLimitCode = "file_parse_timeout" | "file_parse_failed";

/** The parse ran past its time limit or its worker stopped. Routes answer 422. */
export class UploadParseLimitError extends Error {
  readonly code: UploadParseLimitCode;

  constructor(code: UploadParseLimitCode, message: string) {
    super(message);
    this.name = "UploadParseLimitError";
    this.code = code;
  }
}

export const UPLOAD_PARSE_TIMEOUT_MESSAGE = "This file took too long to read. Export it again and retry.";
const UPLOAD_PARSE_FAILED_MESSAGE = "Couldn't read this file. Export it again and retry.";

/** A 10 MB file parses in well under a second; the limit leaves wide room for a busy machine. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Workers parsing at once; later uploads wait their turn. */
const MAX_CONCURRENT_WORKERS = 2;
/** Heap for one parse. A 10 MB file needs a fraction of this. */
const WORKER_MAX_OLD_GENERATION_MB = 512;

let timeoutMs = DEFAULT_TIMEOUT_MS;

/** Test hook: the per-parse time limit. Pass no value to restore the default. */
export function setUploadParseTimeoutMsForTests(ms?: number): void {
  timeoutMs = ms ?? DEFAULT_TIMEOUT_MS;
}

// Compiled output runs `uploadParseWorker.js`; `tsx` dev runs the `.ts` source beside this file.
const workerUrl = new URL(`./uploadParseWorker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

let running = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT_WORKERS) {
    running += 1;
    return;
  }
  // The finishing parse hands its slot straight to the next waiter, so `running` stays put.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

function errorFromMessage(error: { name: string; message: string; code?: string }): Error {
  if (error.name === "GpxActivityParseError") {
    return new GpxActivityParseError(error.code as GpxActivityParseErrorCode, error.message);
  }
  if (error.name === "ActivityFileError") {
    return new ActivityFileError(error.code as ActivityFileErrorCode, error.message);
  }
  return new Error(error.message);
}

function runWorker(task: UploadParseTask, limitMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerUrl, {
      workerData: task,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB }
    });
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new UploadParseLimitError("file_parse_timeout", UPLOAD_PARSE_TIMEOUT_MESSAGE)));
      void worker.terminate();
    }, limitMs);
    worker.once("message", (message: UploadParseMessage) => {
      finish(() => (message.ok ? resolve(message.value) : reject(errorFromMessage(message.error))));
    });
    worker.once("error", () => {
      finish(() => reject(new UploadParseLimitError("file_parse_failed", UPLOAD_PARSE_FAILED_MESSAGE)));
    });
    worker.once("exit", () => {
      finish(() => reject(new UploadParseLimitError("file_parse_failed", UPLOAD_PARSE_FAILED_MESSAGE)));
    });
  });
}

/**
 * Parse an uploaded file off the main thread. Rejects with the same errors the in-process parse
 * throws ({@link GpxActivityParseError}, {@link ActivityFileError}), or {@link UploadParseLimitError}.
 */
export async function parseUploadInWorker<K extends UploadParseTask["kind"]>(
  task: Extract<UploadParseTask, { kind: K }>
): Promise<UploadParseResults[K]> {
  await acquireSlot();
  try {
    return (await runWorker(task, timeoutMs)) as UploadParseResults[K];
  } finally {
    releaseSlot();
  }
}
