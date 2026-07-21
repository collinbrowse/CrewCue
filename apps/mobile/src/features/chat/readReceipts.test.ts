import assert from "node:assert/strict";
import test from "node:test";
import {
  computeReadByEveryone,
  latestDeliveredOwnMessage,
  messageIdsAtOrAfter
} from "./readReceipts.js";

const me = "u-me";
const peerA = "u-peer-a";
const peerB = "u-peer-b";

test("solo channel never shows read by everyone", () => {
  const latestOwn = { id: "m1", sentAtMs: 1000 };
  assert.equal(
    computeReadByEveryone({
      members: { [me]: {} },
      reads: { [me]: { last_read_message_id: "m1" } },
      myStreamUserId: me,
      latestOwn,
      messageIdsAtOrAfterOwn: new Set(["m1"])
    }),
    false
  );
});

test("own markRead alone does not light the footer", () => {
  const latestOwn = { id: "m2", sentAtMs: 2000 };
  assert.equal(
    computeReadByEveryone({
      members: { [me]: {}, [peerA]: {} },
      reads: {
        [me]: { last_read_message_id: "m2", last_read: new Date(2000) },
        [peerA]: { last_read_message_id: "m1", last_read: new Date(2500) }
      },
      myStreamUserId: me,
      latestOwn,
      messageIdsAtOrAfterOwn: new Set(["m2"])
    }),
    false
  );
});

test("last_read timestamp alone must not count as read through latest own", () => {
  // Regression: peers watched recently (fresh last_read) but never got last_read_message_id
  // for the new send — previously compared last_read >= createdAt and flashed the footer.
  const latestOwn = { id: "m-new", sentAtMs: 5000 };
  assert.equal(
    computeReadByEveryone({
      members: { [me]: {}, [peerA]: {} },
      reads: {
        [peerA]: { last_read: new Date(9000) }
      },
      myStreamUserId: me,
      latestOwn,
      messageIdsAtOrAfterOwn: new Set(["m-new"])
    }),
    false
  );
});

test("true only when every peer last_read_message_id reached latest own", () => {
  const latestOwn = { id: "m3", sentAtMs: 3000 };
  assert.equal(
    computeReadByEveryone({
      members: { [me]: {}, [peerA]: {}, [peerB]: {} },
      reads: {
        [peerA]: { last_read_message_id: "m3" },
        [peerB]: { last_read_message_id: "m3" }
      },
      myStreamUserId: me,
      latestOwn,
      messageIdsAtOrAfterOwn: new Set(["m3"])
    }),
    true
  );
});

test("peer who read a later message has read through latest own", () => {
  const latestOwn = { id: "m3", sentAtMs: 3000 };
  assert.equal(
    computeReadByEveryone({
      members: { [me]: {}, [peerA]: {} },
      reads: {
        [peerA]: { last_read_message_id: "m4" }
      },
      myStreamUserId: me,
      latestOwn,
      messageIdsAtOrAfterOwn: new Set(["m3", "m4"])
    }),
    true
  );
});

test("stale previous own message must not keep footer true after a new send", () => {
  // UI already has m-new; if we incorrectly checked peers against m-old (already read),
  // the footer would stay on immediately after send.
  const messages = [
    { id: "m-old", isOwn: true, sentAt: new Date(1000) },
    { id: "m-new", isOwn: true, sentAt: new Date(2000) }
  ];
  const latestOwn = latestDeliveredOwnMessage(messages);
  assert.deepEqual(latestOwn, { id: "m-new", sentAtMs: 2000 });
  const ids = messageIdsAtOrAfter(messages, latestOwn!);
  assert.equal(
    computeReadByEveryone({
      members: { [me]: {}, [peerA]: {} },
      reads: {
        [peerA]: { last_read_message_id: "m-old" }
      },
      myStreamUserId: me,
      latestOwn,
      messageIdsAtOrAfterOwn: ids
    }),
    false
  );
});

test("pending outbox rows are ignored when finding latest own", () => {
  const messages = [
    { id: "m1", isOwn: true, sentAt: new Date(1000) },
    { id: "outbox-xyz", isOwn: true, isPending: true, sentAt: new Date(2000) }
  ];
  assert.deepEqual(latestDeliveredOwnMessage(messages), { id: "m1", sentAtMs: 1000 });
});
