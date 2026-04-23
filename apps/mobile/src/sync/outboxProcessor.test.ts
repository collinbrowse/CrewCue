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

test("processOutboxBatch processes checkpoint manual_stop operation", async () => {
  const calls: Array<{ checkpointId: string; arrivalAt: string; departureAt: string }> = [];
  const client = {
    postManualCheckpointStop: async (
      _roomId: string,
      checkpointId: string,
      input: { arrivalAt: string; departureAt: string }
    ) => {
      calls.push({ checkpointId, arrivalAt: input.arrivalAt, departureAt: input.departureAt });
      return { checkpointSplit: { checkpointId, visits: [], plannedStopSeconds: 120 } };
    }
  } as unknown as ApiClient;

  const operation: OutboxOperation = {
    id: "op-cp-1",
    type: "checkpoint",
    payload: {
      roomId: "room-1",
      checkpointId: "cp-mid",
      action: "manual_stop",
      arrivalAt: "2026-04-22T10:00:00.000Z",
      departureAt: "2026-04-22T10:03:00.000Z",
      note: "test stop"
    },
    attempts: 0,
    status: "pending"
  };

  const result = await processOutboxBatch(client, [operation], () => "2026-04-22T10:03:01.000Z");

  assert.equal(result.processedCount, 1);
  assert.equal(result.operations[0]?.status, "sent");
  assert.equal(result.operations[0]?.feedback, "Manual stop saved.");
  assert.deepEqual(result.touchedRoomIds, ["room-1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.checkpointId, "cp-mid");
});

test("processOutboxBatch processes checkpoint set_resolved_source operation", async () => {
  const calls: Array<{ checkpointId: string; visitIndex: number; resolvedSource: string }> = [];
  const client = {
    patchCheckpointVisitResolvedSource: async (
      _roomId: string,
      checkpointId: string,
      visitIndex: number,
      input: { resolvedSource: string }
    ) => {
      calls.push({ checkpointId, visitIndex, resolvedSource: input.resolvedSource });
      return { checkpointSplit: { checkpointId, visits: [], plannedStopSeconds: 120 } };
    }
  } as unknown as ApiClient;

  const operation: OutboxOperation = {
    id: "op-cp-2",
    type: "checkpoint",
    payload: {
      roomId: "room-1",
      checkpointId: "cp-mid",
      action: "set_resolved_source",
      visitIndex: 0,
      resolvedSource: "manual_crew"
    },
    attempts: 0,
    status: "pending"
  };

  const result = await processOutboxBatch(client, [operation], () => "2026-04-22T10:05:01.000Z");

  assert.equal(result.processedCount, 1);
  assert.equal(result.operations[0]?.status, "sent");
  assert.equal(result.operations[0]?.feedback, "Stop source updated.");
  assert.deepEqual(result.touchedRoomIds, ["room-1"]);
  assert.equal(calls[0]?.visitIndex, 0);
  assert.equal(calls[0]?.resolvedSource, "manual_crew");
});
