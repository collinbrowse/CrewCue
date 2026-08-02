import assert from "node:assert/strict";
import test from "node:test";
import { mergeOutboxByConflictKey, mergeProcessedBatch } from "./outboxMerge.js";
import type { OutboxOperation } from "./outboxTypes.js";

test("mergeOutboxByConflictKey replaces pending op with same conflictKey", () => {
  const existing: OutboxOperation[] = [
    {
      id: "first",
      type: "checkpoint",
      payload: { v: 1 },
      attempts: 0,
      status: "pending",
      conflictKey: "manual-stop:r:cp:1"
    }
  ];
  const merged = mergeOutboxByConflictKey(
    existing,
    {
      id: "second",
      type: "checkpoint",
      payload: { v: 2 },
      attempts: 0,
      status: "pending"
    },
    "manual-stop:r:cp:1"
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "second");
  assert.equal((merged[0]?.payload as { v: number }).v, 2);
});

test("mergeProcessedBatch preserves ops enqueued after the batch snapshot", () => {
  const current: OutboxOperation[] = [
    {
      id: "op-a",
      type: "ping",
      payload: { roomId: "room-1" },
      attempts: 0,
      status: "pending"
    },
    {
      id: "op-b",
      type: "task",
      payload: { roomId: "room-1", taskId: "t1", action: "start" },
      attempts: 0,
      status: "pending"
    }
  ];
  const processedById = new Map<string, OutboxOperation>([
    [
      "op-a",
      {
        id: "op-a",
        type: "ping",
        payload: { roomId: "room-1" },
        attempts: 1,
        status: "sent",
        feedback: "Sent.",
        updatedAt: "2026-08-02T06:00:00.000Z"
      }
    ]
  ]);

  const merged = mergeProcessedBatch(current, new Set(["op-a"]), processedById);

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.status, "sent");
  assert.equal(merged[0]?.attempts, 1);
  assert.equal(merged[1]?.id, "op-b");
  assert.equal(merged[1]?.status, "pending");
});

test("mergeProcessedBatch does not resurrect ops removed during processing", () => {
  const current: OutboxOperation[] = [
    {
      id: "op-b",
      type: "task",
      payload: { roomId: "room-1", taskId: "t1", action: "complete" },
      attempts: 0,
      status: "pending"
    }
  ];
  const processedById = new Map<string, OutboxOperation>([
    [
      "op-a",
      {
        id: "op-a",
        type: "ping",
        payload: { roomId: "room-1" },
        attempts: 1,
        status: "sent"
      }
    ]
  ]);

  const merged = mergeProcessedBatch(current, new Set(["op-a"]), processedById);

  assert.deepEqual(
    merged.map((op) => op.id),
    ["op-b"]
  );
});
