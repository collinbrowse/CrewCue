import test from "node:test";
import assert from "node:assert/strict";
import { formatEtaClock, formatRemainingMinutes, secondsForDistance } from "./eta";

test("secondsForDistance converts meters with pace", () => {
  assert.equal(secondsForDistance(5000, 360), 1800);
  assert.equal(secondsForDistance(-1, 360), 0);
  assert.equal(secondsForDistance(1000, 0), 0);
});

test("formatRemainingMinutes keeps compact hour/min output", () => {
  assert.equal(formatRemainingMinutes(65 * 60), "1H 5M");
  assert.equal(formatRemainingMinutes(8 * 60), "8M");
  assert.equal(formatRemainingMinutes(2 * 60 * 60), "2H");
});

test("formatEtaClock returns placeholder for invalid values", () => {
  assert.equal(formatEtaClock(Number.NaN), "--");
  assert.notEqual(formatEtaClock(Date.UTC(2026, 0, 1, 7, 30, 0)), "--");
});
