/**
 * Background jobs for bulk activity uploads (`/activity-history/upload`). Reading a whole watch-app
 * export takes tens of seconds on a slow server, longer than a phone keeps a request open, so the
 * upload returns a job id at once and the app polls for the result.
 *
 * Jobs live in this process's memory. The API runs as one instance, so the poll reaches the
 * process that holds the job. A restart loses running jobs: the poll gets 404 and the app says to
 * try again. Nothing is half-saved by that, because imports upsert by file fingerprint.
 */
import { randomUUID } from "node:crypto";

export type UploadJobState =
  | { state: "running" }
  | { state: "done"; status: number; body: unknown }
  | { state: "failed"; status: number; body: unknown };

type UploadJob = {
  id: string;
  ownerId: string;
  result: UploadJobState;
  /** Set when the owner starts another upload: the reader stops at its next yield. */
  cancelled: boolean;
  /** When a finished job is dropped (ms since epoch). */
  expiresAtMs: number | null;
};

/** How long a finished job's result waits for the app's next poll. */
export const UPLOAD_JOB_RESULT_TTL_MS = 10 * 60 * 1000;

const jobs = new Map<string, UploadJob>();

/** Thrown from a job's work when the owner started another upload. */
export class UploadJobCancelled extends Error {
  constructor() {
    super("Upload replaced by a newer one");
  }
}

export type UploadJobContext = {
  /** Lets other requests (location pings) run; throws `UploadJobCancelled` once replaced. */
  yieldNow(): Promise<void>;
};

function sweep(nowMs: number): void {
  for (const [id, job] of jobs) {
    if (job.expiresAtMs !== null && job.expiresAtMs <= nowMs) jobs.delete(id);
  }
}

/**
 * Start `work` in the background and return the job id. One upload per owner: starting another
 * cancels the one still running (the app only ever shows the latest share).
 */
export function startUploadJob(
  ownerId: string,
  work: (context: UploadJobContext) => Promise<{ status: number; body: unknown }>,
  onError: (err: unknown) => { status: number; body: unknown }
): string {
  const nowMs = Date.now();
  sweep(nowMs);
  for (const other of jobs.values()) {
    if (other.ownerId === ownerId && other.result.state === "running") other.cancelled = true;
  }
  const job: UploadJob = { id: randomUUID(), ownerId, result: { state: "running" }, cancelled: false, expiresAtMs: null };
  jobs.set(job.id, job);
  const context: UploadJobContext = {
    async yieldNow() {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (job.cancelled) throw new UploadJobCancelled();
    }
  };
  void (async () => {
    try {
      await context.yieldNow();
      const { status, body } = await work(context);
      job.result = { state: "done", status, body };
    } catch (err) {
      if (err instanceof UploadJobCancelled) {
        jobs.delete(job.id);
        return;
      }
      const { status, body } = onError(err);
      job.result = { state: "failed", status, body };
    }
    job.expiresAtMs = Date.now() + UPLOAD_JOB_RESULT_TTL_MS;
  })();
  return job.id;
}

/** The job's state for its owner; null when it doesn't exist, expired, or isn't theirs. */
export function uploadJobFor(ownerId: string, jobId: string): UploadJobState | null {
  sweep(Date.now());
  const job = jobs.get(jobId);
  if (!job || job.ownerId !== ownerId) return null;
  return job.result;
}

/** Tests: wait until every job has finished. */
export async function settleUploadJobsForTests(): Promise<void> {
  while ([...jobs.values()].some((job) => job.result.state === "running")) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

export function resetUploadJobsForTests(): void {
  jobs.clear();
}
