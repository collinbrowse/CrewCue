import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../api/client";
import type { OutboxOperation } from "./outboxStore";
import { isSafeOutboxRetryCandidate, resolveOutboxFailure } from "./outboxPolicy";

test("resolveOutboxFailure keeps retrying network-like failures", () => {
  const resolution = resolveOutboxFailure(new TypeError("fetch failed"));

  assert.deepEqual(resolution, {
    status: "pending",
    retryable: true,
    feedback: "fetch failed"
  });
});

test("resolveOutboxFailure marks 409 responses as conflicts", () => {
  const resolution = resolveOutboxFailure(
    new ApiError(409, { error: "Race room must be active" }, "Race room must be active")
  );

  assert.deepEqual(resolution, {
    status: "conflict",
    retryable: false,
    feedback: "Race room must be active"
  });
});

test("resolveOutboxFailure marks ping rejection payloads as rejected", () => {
  const resolution = resolveOutboxFailure(
    new ApiError(
      422,
      {
        decision: "rejected",
        reason: "clock_skew",
        message: "recordedAt is too far from server time"
      },
      "Unprocessable Entity"
    )
  );

  assert.deepEqual(resolution, {
    status: "rejected",
    retryable: false,
    feedback: "recordedAt is too far from server time"
  });
});

test("isSafeOutboxRetryCandidate allows pending ping operations", () => {
  const operation: OutboxOperation = {
    id: "op-ping-1",
    type: "ping",
    payload: { roomId: "room-1" },
    attempts: 1,
    status: "pending"
  };

  assert.equal(isSafeOutboxRetryCandidate(operation), true);
});

test("isSafeOutboxRetryCandidate blocks sent and non-ping operations", () => {
  const sentPing: OutboxOperation = {
    id: "op-ping-sent",
    type: "ping",
    payload: { roomId: "room-1" },
    attempts: 1,
    status: "sent"
  };
  const pendingTask: OutboxOperation = {
    id: "op-task-1",
    type: "task",
    payload: { roomId: "room-1" },
    attempts: 0,
    status: "pending"
  };

  assert.equal(isSafeOutboxRetryCandidate(sentPing), false);
  assert.equal(isSafeOutboxRetryCandidate(pendingTask), false);
});
