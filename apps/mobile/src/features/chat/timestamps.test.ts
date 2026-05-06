import test from "node:test";
import assert from "node:assert/strict";
import { formatChatTimestamp, formatHHMM, shouldShowArrivalTime } from "./timestamps";

test("timestamps: formatHHMM zero-pads", () => {
  assert.equal(formatHHMM(new Date(2026, 0, 1, 7, 5)), "07:05");
  assert.equal(formatHHMM(new Date(2026, 0, 1, 23, 59)), "23:59");
});

test("timestamps: shouldShowArrivalTime suppresses small gaps", () => {
  const a = new Date("2026-05-06T08:00:00Z");
  const b = new Date("2026-05-06T08:00:10Z");
  assert.equal(shouldShowArrivalTime(a, b), false);
});

test("timestamps: shouldShowArrivalTime shows 30s+ gaps", () => {
  const a = new Date("2026-05-06T08:00:00Z");
  const b = new Date("2026-05-06T08:00:35Z");
  assert.equal(shouldShowArrivalTime(a, b), true);
});

test("timestamps: formatChatTimestamp omits arrival when undefined", () => {
  const out = formatChatTimestamp(new Date(2026, 0, 1, 12, 0));
  assert.equal(out.sent, "12:00");
  assert.equal(out.arrived, undefined);
});
