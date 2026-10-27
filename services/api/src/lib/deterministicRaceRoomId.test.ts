import assert from "node:assert/strict";
import test from "node:test";
import { deterministicRaceRoomId } from "./deterministicRaceRoomId.js";

test("deterministicRaceRoomId is stable for the same user and key", () => {
  const a = deterministicRaceRoomId("user-1", "create-room:user-1:abc");
  const b = deterministicRaceRoomId("user-1", "create-room:user-1:abc");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("deterministicRaceRoomId differs across users and keys", () => {
  const base = deterministicRaceRoomId("user-1", "key-a");
  assert.notEqual(base, deterministicRaceRoomId("user-2", "key-a"));
  assert.notEqual(base, deterministicRaceRoomId("user-1", "key-b"));
});
