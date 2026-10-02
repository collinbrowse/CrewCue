import assert from "node:assert/strict";
import test from "node:test";
import { createOutboxController } from "./outboxLock.js";
import type { OutboxOperation } from "./outboxTypes.js";

function op(id: string, status: OutboxOperation["status"] = "pending"): OutboxOperation {
  return { id, type: "checkpoint", payload: { id }, attempts: 0, status };
}

function yieldingStore(initial: OutboxOperation[]) {
  let stored = initial.map((entry) => ({ ...entry }));
  const io = {
    async read(): Promise<OutboxOperation[]> {
      await Promise.resolve();
      return stored.map((entry) => ({ ...entry }));
    },
    async write(operations: OutboxOperation[]): Promise<void> {
      await Promise.resolve();
      stored = operations.map((entry) => ({ ...entry }));
    }
  };
  return {
    controller: createOutboxController(io),
    snapshot: () => stored.map((entry) => ({ ...entry }))
  };
}

test("flush keeps a check-in enqueued while the send is in flight", async () => {
  const { controller, snapshot } = yieldingStore([op("ping-1", "pending")]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const enteredFlush = new Promise<void>((resolve) => {
    entered = resolve;
  });

  const flushPromise = controller.flush(async (operations) => {
    entered();
    await gate;
    return operations.map((entry) => ({ ...entry, status: "sent" as const }));
  });
  await enteredFlush;

  const checkIn = op("manual-stop-1", "pending");
  const enqueuePromise = controller.enqueue(checkIn);
  release();
  await flushPromise;
  await enqueuePromise;

  const ids = snapshot()
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(ids, ["manual-stop-1", "ping-1"]);
  assert.equal(snapshot().find((entry) => entry.id === "ping-1")?.status, "sent");
  assert.equal(snapshot().find((entry) => entry.id === "manual-stop-1")?.status, "pending");
});

test("overlapping enqueues both persist", async () => {
  const { controller, snapshot } = yieldingStore([]);
  await Promise.all([controller.enqueue(op("a")), controller.enqueue(op("b"))]);
  assert.deepEqual(
    snapshot()
      .map((entry) => entry.id)
      .sort(),
    ["a", "b"]
  );
});
