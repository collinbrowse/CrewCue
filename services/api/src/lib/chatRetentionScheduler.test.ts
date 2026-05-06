import test from "node:test";
import assert from "node:assert/strict";
import {
  runChatRetentionScheduledPass,
  startChatRetentionScheduler,
  stopChatRetentionScheduler
} from "./chatRetentionScheduler.js";
import { _resetChatPersistenceForTests } from "./chatPersistence.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function silentLogger() {
  const calls: Array<{ level: string; payload: unknown; msg: string }> = [];
  const fn = (level: string) =>
    ((...args: unknown[]) => {
      const [payload, msg] = args.length >= 2 ? [args[0], String(args[1] ?? "")] : [{}, String(args[0] ?? "")];
      calls.push({ level, payload, msg });
      return undefined;
    }) as never;
  return {
    info: fn("info"),
    warn: fn("warn"),
    calls
  };
}

test("runChatRetentionScheduledPass purges only eligible rooms and logs once", async () => {
  _resetChatPersistenceForTests();
  const log = silentLogger();
  const now = new Date("2026-06-01T00:00:00Z");
  const rooms = [
    {
      id: "room-old",
      eventEndsAt: new Date(now.getTime() - 31 * MS_PER_DAY).toISOString(),
      status: "completed" as const
    },
    {
      id: "room-recent",
      eventEndsAt: new Date(now.getTime() - 5 * MS_PER_DAY).toISOString(),
      status: "completed" as const
    }
  ];

  const results = await runChatRetentionScheduledPass(async () => rooms, log, now);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.roomId, "room-old");
  const passLog = log.calls.find((c) => c.msg === "chat_retention_pass");
  assert.ok(passLog, "expected chat_retention_pass log entry");
});

test("runChatRetentionScheduledPass swallows listRooms errors and logs warn", async () => {
  const log = silentLogger();
  const results = await runChatRetentionScheduledPass(
    async () => {
      throw new Error("db down");
    },
    log
  );
  assert.deepEqual(results, []);
  const warnLog = log.calls.find((c) => c.msg === "chat_retention_pass_failed");
  assert.ok(warnLog, "expected chat_retention_pass_failed warn log");
});

test("startChatRetentionScheduler is idempotent and stoppable", () => {
  const log = silentLogger();
  startChatRetentionScheduler(async () => [], log, {
    intervalMs: 60_000,
    skipFirstRun: true
  });
  startChatRetentionScheduler(async () => [], log, {
    intervalMs: 60_000,
    skipFirstRun: true
  });
  stopChatRetentionScheduler();
  // Calling stop again should be a no-op.
  stopChatRetentionScheduler();
});
