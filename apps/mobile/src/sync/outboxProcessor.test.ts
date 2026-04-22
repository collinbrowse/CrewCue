import test from "node:test";
import assert from "node:assert/strict";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import { processOutboxBatch } from "./outboxProcessor";
import type { OutboxOperation } from "./outboxStore";

function heartbeatOperation(id: string, roomId: string): OutboxOperation {
  return {
    id,
    type: "ping",
    payload: {
      roomId,
      deviceId: `device-${id}`,
      pendingQueueCount: 1
    },
    attempts: 0,
    status: "pending"
  };
}

test("processOutboxBatch marks successful operations as sent", async () => {
  const client = {
    postSyncHeartbeat: async () => ({
      ok: true as const,
      lastHeartbeatAt: "2026-04-22T14:00:00.000Z"
    })
  } as unknown as ApiClient;

  const result = await processOutboxBatch(client, [heartbeatOperation("op-1", "room-1")], () => "2026-04-22T14:00:01.000Z");

  assert.equal(result.processedCount, 1);
  assert.deepEqual(result.touchedRoomIds, ["room-1"]);
  assert.equal(result.operations[0]?.status, "sent");
  assert.equal(result.operations[0]?.attempts, 1);
  assert.equal(result.operations[0]?.feedback, "Sent at 2026-04-22T14:00:00.000Z.");
  assert.equal(result.operations[0]?.updatedAt, "2026-04-22T14:00:01.000Z");
});

test("processOutboxBatch marks conflicts and continues to later items", async () => {
  const client = {
    postSyncHeartbeat: async (roomId: string) => {
      if (roomId === "room-conflict") {
        throw new ApiError(409, { error: "Race room must be active" }, "Race room must be active");
      }

      return {
        ok: true as const,
        lastHeartbeatAt: "2026-04-22T14:01:00.000Z"
      };
    }
  } as unknown as ApiClient;

  const result = await processOutboxBatch(
    client,
    [heartbeatOperation("op-1", "room-conflict"), heartbeatOperation("op-2", "room-2")],
    () => "2026-04-22T14:01:01.000Z"
  );

  assert.equal(result.processedCount, 1);
  assert.equal(result.operations[0]?.status, "conflict");
  assert.equal(result.operations[1]?.status, "sent");
  assert.deepEqual(result.touchedRoomIds, ["room-2"]);
  assert.deepEqual(result.operatorSignal, {
    label: "sync heartbeat",
    feedback: "Race room must be active",
    status: "conflict"
  });
});

test("processOutboxBatch leaves retryable failures pending and stops the batch", async () => {
  const client = {
    postSyncHeartbeat: async () => {
      throw new TypeError("fetch failed");
    }
  } as unknown as ApiClient;

  const result = await processOutboxBatch(
    client,
    [heartbeatOperation("op-1", "room-1"), heartbeatOperation("op-2", "room-2")],
    () => "2026-04-22T14:02:01.000Z"
  );

  assert.equal(result.processedCount, 0);
  assert.equal(result.operations[0]?.status, "pending");
  assert.equal(result.operations[0]?.attempts, 1);
  assert.equal(result.operations[1]?.status, "pending");
  assert.equal(result.operations[1]?.attempts, 0);
  assert.deepEqual(result.operatorSignal, {
    label: "sync heartbeat",
    feedback: "fetch failed",
    status: "pending"
  });
});
