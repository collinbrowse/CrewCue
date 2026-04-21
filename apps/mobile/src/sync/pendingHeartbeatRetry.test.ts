import test from "node:test";
import assert from "node:assert/strict";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/client";
import { postSyncHeartbeatWithRetryWithPersistence } from "./pendingHeartbeatRetry";

test("postSyncHeartbeatWithRetryWithPersistence returns response when POST succeeds", async () => {
  const client = {
    postSyncHeartbeat: async () => ({
      ok: true as const,
      lastHeartbeatAt: "2026-04-21T12:00:00.000Z"
    })
  } as unknown as ApiClient;

  const result = await postSyncHeartbeatWithRetryWithPersistence(
    client,
    {
      roomId: "room-1",
      deviceId: "dev-1",
      pendingQueueCount: 0
    },
    async () => {
      assert.fail("persistForRetry should not run on success");
    }
  );

  assert.equal(result.persistedForRetry, false);
  if (!result.persistedForRetry) {
    assert.equal(result.response.ok, true);
    assert.equal(result.response.lastHeartbeatAt, "2026-04-21T12:00:00.000Z");
  }
});

test("postSyncHeartbeatWithRetryWithPersistence persists on network-like failure", async () => {
  const client = {
    postSyncHeartbeat: async () => {
      throw new TypeError("fetch failed");
    }
  } as unknown as ApiClient;

  const persisted: unknown[] = [];
  const result = await postSyncHeartbeatWithRetryWithPersistence(
    client,
    {
      roomId: "room-2",
      deviceId: "dev-2",
      pendingQueueCount: 3
    },
    async (p) => {
      persisted.push(p);
    }
  );

  assert.equal(result.persistedForRetry, true);
  if (result.persistedForRetry) {
    assert.deepEqual(result.pendingHeartbeat, {
      roomId: "room-2",
      deviceId: "dev-2",
      pendingQueueCount: 3
    });
  }
  assert.equal(persisted.length, 1);
});

test("postSyncHeartbeatWithRetryWithPersistence does not swallow ApiError", async () => {
  const client = {
    postSyncHeartbeat: async () => {
      throw new ApiError(403, {}, "Forbidden");
    }
  } as unknown as ApiClient;

  await assert.rejects(
    postSyncHeartbeatWithRetryWithPersistence(
      client,
      { roomId: "r", deviceId: "d", pendingQueueCount: 0 },
      async () => {
        assert.fail("should not persist");
      }
    ),
    (e: unknown) => (e as { status?: number }).status === 403
  );
});
