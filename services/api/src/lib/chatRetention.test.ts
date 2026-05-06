import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_RETENTION_DAYS,
  computeChatRemovalDate,
  isRoomEligibleForChatDeletion,
  runChatRetentionPass
} from "./chatRetention.js";
import { _resetChatPersistenceForTests } from "./chatPersistence.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

test("isRoomEligibleForChatDeletion: false before retention window", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const eventEndsAt = new Date(now.getTime() - 10 * MS_PER_DAY).toISOString();
  assert.equal(
    isRoomEligibleForChatDeletion({ eventEndsAt, status: "completed" }, now),
    false
  );
});

test("isRoomEligibleForChatDeletion: true exactly at retention window", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const eventEndsAt = new Date(now.getTime() - CHAT_RETENTION_DAYS * MS_PER_DAY).toISOString();
  assert.equal(
    isRoomEligibleForChatDeletion({ eventEndsAt, status: "completed" }, now),
    true
  );
});

test("isRoomEligibleForChatDeletion: false when no eventEndsAt", () => {
  assert.equal(
    isRoomEligibleForChatDeletion({ status: "draft" }, new Date()),
    false
  );
});

test("computeChatRemovalDate adds 30 days", () => {
  const removal = computeChatRemovalDate("2026-05-01T00:00:00Z");
  assert.ok(removal);
  assert.equal(removal!.toISOString(), "2026-05-31T00:00:00.000Z");
});

test("runChatRetentionPass only deletes eligible rooms", async () => {
  _resetChatPersistenceForTests();
  const now = new Date("2026-06-01T00:00:00Z");
  const results = await runChatRetentionPass(
    [
      {
        id: "room-old",
        eventEndsAt: new Date(now.getTime() - 31 * MS_PER_DAY).toISOString(),
        status: "completed"
      },
      {
        id: "room-recent",
        eventEndsAt: new Date(now.getTime() - 5 * MS_PER_DAY).toISOString(),
        status: "completed"
      }
    ],
    now
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.roomId, "room-old");
});
