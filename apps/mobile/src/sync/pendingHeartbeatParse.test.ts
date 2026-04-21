import test from "node:test";
import assert from "node:assert/strict";
import { parsePendingHeartbeat } from "./pendingHeartbeatParse";

test("parsePendingHeartbeat accepts valid JSON", () => {
  const raw = JSON.stringify({ roomId: "r1", deviceId: "d1", pendingQueueCount: 2 });
  assert.deepEqual(parsePendingHeartbeat(raw), {
    roomId: "r1",
    deviceId: "d1",
    pendingQueueCount: 2
  });
});

test("parsePendingHeartbeat rejects invalid shapes", () => {
  assert.equal(parsePendingHeartbeat(null), undefined);
  assert.equal(parsePendingHeartbeat(""), undefined);
  assert.equal(parsePendingHeartbeat("{"), undefined);
  assert.equal(parsePendingHeartbeat(JSON.stringify({ roomId: 1 })), undefined);
  assert.equal(
    parsePendingHeartbeat(JSON.stringify({ roomId: "r", deviceId: "d", pendingQueueCount: 1.5 })),
    undefined
  );
});
