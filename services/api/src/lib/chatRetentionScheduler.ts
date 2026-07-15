/**
 * Chat retention scheduler (Phase 7 — issue #234).
 *
 * Runs `runChatRetentionPass` on a fixed cadence (default: every 6 hours) so
 * crew chat metadata (prefs, push tokens) is purged 30 days after the race
 * ends. The scheduler is intentionally minimal — Phase 7 v1 doesn't pull in a
 * real cron framework; we just use `setInterval` and let the host process stay
 * long-lived. The job is idempotent so missing a run only delays cleanup.
 *
 * In production the scheduler must also call `Stream.deleteChannel(...)` for
 * each result so channel messages are removed from Stream's storage. That's a
 * one-line addition once the Stream server SDK credentials are wired and is
 * intentionally left as a runbook step (see docs/runbooks/chat-retention.md).
 */
import type { FastifyBaseLogger } from "fastify";
import type { ChatRetentionResult, RaceRoom } from "@crewcue/contracts";
import { runChatRetentionPass } from "./chatRetention.js";

export type ChatRetentionListRooms = () => Promise<
  Array<Pick<RaceRoom, "id" | "eventEndsAt" | "status">>
>;

export type ChatRetentionSchedulerOptions = {
  /** Polling interval in milliseconds. Default: 6 hours. */
  intervalMs?: number;
  /**
   * Skip the initial run that fires when the scheduler starts. Useful in
   * tests so the caller can drive the first invocation manually.
   */
  skipFirstRun?: boolean;
};

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let activeHandle: ReturnType<typeof setInterval> | undefined;

export async function runChatRetentionScheduledPass(
  listRooms: ChatRetentionListRooms,
  log: Pick<FastifyBaseLogger, "info" | "warn">,
  now: Date = new Date()
): Promise<ChatRetentionResult[]> {
  try {
    const rooms = await listRooms();
    const results = await runChatRetentionPass(rooms, now);
    log.info(
      {
        chatRetention: {
          scanned: rooms.length,
          purged: results.length,
          rooms: results.map((r) => r.roomId)
        }
      },
      "chat_retention_pass"
    );
    return results;
  } catch (err) {
    log.warn(
      { err, chatRetention: { phase: "scheduled_pass" } },
      "chat_retention_pass_failed"
    );
    return [];
  }
}

export function startChatRetentionScheduler(
  listRooms: ChatRetentionListRooms,
  log: Pick<FastifyBaseLogger, "info" | "warn">,
  opts: ChatRetentionSchedulerOptions = {}
): void {
  if (activeHandle) {
    return;
  }
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!opts.skipFirstRun) {
    void runChatRetentionScheduledPass(listRooms, log);
  }
  activeHandle = setInterval(() => {
    void runChatRetentionScheduledPass(listRooms, log);
  }, interval);
  // Don't keep the process alive solely for the timer.
  if (typeof activeHandle.unref === "function") {
    activeHandle.unref();
  }
}

export function stopChatRetentionScheduler(): void {
  if (activeHandle) {
    clearInterval(activeHandle);
    activeHandle = undefined;
  }
}
