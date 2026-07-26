import test from "node:test";
import assert from "node:assert/strict";
import {
  isDuplicateStreamMessageError,
  makeEntry,
  shouldClaimOutboxSend,
  streamMessageIdForOutboxEntry,
  transitionEntry,
  type ChatOutboxEntry
} from "./messageQueueCore";

test("messageQueue: makeEntry builds a pending entry with stable shape", () => {
  const entry = makeEntry(
    { roomId: "room-1", body: "hi", mentionedUserIds: ["u1"] },
    1000,
    "fixed-id"
  );
  assert.equal(entry.id, "fixed-id");
  assert.equal(entry.status, "pending");
  assert.equal(entry.attempts, 0);
  assert.equal(entry.body, "hi");
  assert.deepEqual(entry.mentionedUserIds, ["u1"]);
  assert.equal(entry.createdAtMs, 1000);
});

test("messageQueue: send_started transitions to sending and increments attempts", () => {
  const start = makeEntry({ roomId: "r", body: "x" }, 0, "id-1");
  const next = transitionEntry(start, { kind: "send_started" });
  assert.equal(next.status, "sending");
  assert.equal(next.attempts, 1);
  assert.equal(next.lastError, undefined);
});

test("messageQueue: send_failed retains attempts count and stores error", () => {
  const a = transitionEntry(makeEntry({ roomId: "r", body: "x" }, 0, "id-2"), {
    kind: "send_started"
  });
  const b = transitionEntry(a, { kind: "send_failed", error: "network" });
  assert.equal(b.status, "failed");
  assert.equal(b.attempts, 1);
  assert.equal(b.lastError, "network");
});

test("messageQueue: subsequent retry continues to increment attempts", () => {
  let entry: ChatOutboxEntry = makeEntry({ roomId: "r", body: "x" }, 0, "id-3");
  entry = transitionEntry(entry, { kind: "send_started" });
  entry = transitionEntry(entry, { kind: "send_failed", error: "down" });
  entry = transitionEntry(entry, { kind: "send_started" });
  entry = transitionEntry(entry, { kind: "send_failed", error: "down again" });
  assert.equal(entry.attempts, 2);
  assert.equal(entry.status, "failed");
  assert.equal(entry.lastError, "down again");
});

test("messageQueue: send_succeeded clears lastError and stamps remoteMessageId", () => {
  let entry: ChatOutboxEntry = makeEntry({ roomId: "r", body: "x" }, 0, "id-4");
  entry = transitionEntry(entry, { kind: "send_started" });
  entry = transitionEntry(entry, { kind: "send_failed", error: "boom" });
  entry = transitionEntry(entry, { kind: "send_started" });
  entry = transitionEntry(entry, { kind: "send_succeeded", remoteMessageId: "stream-msg-1" });
  assert.equal(entry.status, "sent");
  assert.equal(entry.remoteMessageId, "stream-msg-1");
  assert.equal(entry.lastError, undefined);
  assert.equal(entry.attempts, 2);
});

test("messageQueue: reclaim persisted sending when no live in-flight owner", () => {
  assert.equal(shouldClaimOutboxSend("sending", false), true);
  assert.equal(shouldClaimOutboxSend("sending", true), false);
  assert.equal(shouldClaimOutboxSend("pending", false), true);
  assert.equal(shouldClaimOutboxSend("failed", false), true);
  assert.equal(shouldClaimOutboxSend("sent", false), false);
  assert.equal(shouldClaimOutboxSend("pending", true), false);
});

test("messageQueue: stream client message ids are stable and Stream-safe", () => {
  assert.equal(streamMessageIdForOutboxEntry("1720-abc"), "ccq-1720-abc");
  assert.equal(streamMessageIdForOutboxEntry("a,b%c"), "ccq-a_b_c");
  assert.ok(streamMessageIdForOutboxEntry("x".repeat(400)).length <= 255);
});

test("messageQueue: duplicate Stream message id errors are detected", () => {
  assert.equal(
    isDuplicateStreamMessageError(
      new Error('SendMessage failed with error: "a message with ID ccq-1 already exists"')
    ),
    true
  );
  assert.equal(isDuplicateStreamMessageError(new Error("network timeout")), false);
  assert.equal(
    isDuplicateStreamMessageError({ message: "a message with ID x already exists", code: 4 }),
    true
  );
});
