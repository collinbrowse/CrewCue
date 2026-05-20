import assert from "node:assert/strict";
import test from "node:test";
import { mergeOutboxByConflictKey } from "./outboxMerge.js";
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
