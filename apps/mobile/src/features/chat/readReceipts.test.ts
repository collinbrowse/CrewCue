import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMessageReadEvent,
  computeOwnMessageIdsReadByEveryone,
  snapshotChannelReads
} from "./readReceipts.js";

const me = "u-me";
const peerA = "u-peer-a";
const peerB = "u-peer-b";

test("solo channel yields no read receipt ids", () => {
  const ids = computeOwnMessageIdsReadByEveryone({
    members: { [me]: {} },
    reads: { [me]: { last_read_message_id: "m1" } },
    myStreamUserId: me,
    messages: [{ id: "m1", isOwn: true, sentAt: new Date(1000) }]
  });
  assert.equal(ids.size, 0);
});

test("idle roster members without read state do not block receipts", () => {
  const ids = computeOwnMessageIdsReadByEveryone({
    members: { [me]: {}, [peerA]: {}, [peerB]: {} },
    reads: {
      [me]: { last_read_message_id: "m1" },
      [peerA]: { last_read_message_id: "m1", last_read: new Date(2000) }
      // peerB never opened chat — absent from reads
    },
    myStreamUserId: me,
    messages: [{ id: "m1", isOwn: true, sentAt: new Date(1000) }]
  });
  assert.equal(ids.has("m1"), true);
});

test("own markRead alone does not mark own messages read by everyone", () => {
  const ids = computeOwnMessageIdsReadByEveryone({
    members: { [me]: {}, [peerA]: {} },
    reads: {
      [me]: { last_read_message_id: "m2", last_read: new Date(2000) },
      [peerA]: { last_read_message_id: "m1", last_read: new Date(2500) }
    },
    myStreamUserId: me,
    messages: [
      { id: "m1", isOwn: true, sentAt: new Date(1000) },
      { id: "m2", isOwn: true, sentAt: new Date(2000) }
    ]
  });
  assert.equal(ids.has("m2"), false);
  assert.equal(ids.has("m1"), true);
});

test("last_read timestamp counts only when at or after message send", () => {
  const messages = [{ id: "m-new", isOwn: true, sentAt: new Date(5000) }];
  assert.equal(
    computeOwnMessageIdsReadByEveryone({
      members: { [me]: {}, [peerA]: {} },
      reads: { [peerA]: { last_read: new Date(9000) } },
      myStreamUserId: me,
      messages
    }).has("m-new"),
    true
  );
  assert.equal(
    computeOwnMessageIdsReadByEveryone({
      members: { [me]: {}, [peerA]: {} },
      reads: { [peerA]: { last_read: new Date(4000) } },
      myStreamUserId: me,
      messages
    }).has("m-new"),
    false
  );
});

test("peer last_read_message_id must cover the own message", () => {
  const messages = [
    { id: "m1", isOwn: true, sentAt: new Date(1000) },
    { id: "m2", isOwn: true, sentAt: new Date(2000) },
    { id: "m3", isOwn: false, sentAt: new Date(3000) }
  ];
  const ids = computeOwnMessageIdsReadByEveryone({
    members: { [me]: {}, [peerA]: {}, [peerB]: {} },
    reads: {
      [peerA]: { last_read_message_id: "m3" },
      [peerB]: { last_read_message_id: "m2" }
    },
    myStreamUserId: me,
    messages
  });
  assert.equal(ids.has("m1"), true);
  assert.equal(ids.has("m2"), true);
  assert.equal(ids.has("m3"), false);
});

test("pending outbox rows are ignored", () => {
  const ids = computeOwnMessageIdsReadByEveryone({
    members: { [me]: {}, [peerA]: {} },
    reads: { [peerA]: { last_read: new Date(9000) } },
    myStreamUserId: me,
    messages: [
      { id: "m1", isOwn: true, sentAt: new Date(1000) },
      { id: "outbox-xyz", isOwn: true, isPending: true, sentAt: new Date(2000) }
    ]
  });
  assert.equal(ids.has("m1"), true);
  assert.equal(ids.has("outbox-xyz"), false);
});

test("applyMessageReadEvent merges peer read into snapshot", () => {
  const next = applyMessageReadEvent(
    {},
    {
      user: { id: peerA },
      last_read_message_id: "m9",
      created_at: "2026-07-21T12:00:00.000Z"
    }
  );
  assert.equal(next[peerA]?.last_read_message_id, "m9");
  assert.ok(next[peerA]?.last_read);
});

test("snapshotChannelReads copies plain fields", () => {
  const snap = snapshotChannelReads({
    [peerA]: { last_read_message_id: "m1", last_read: new Date(1) }
  });
  assert.equal(snap[peerA]?.last_read_message_id, "m1");
});
