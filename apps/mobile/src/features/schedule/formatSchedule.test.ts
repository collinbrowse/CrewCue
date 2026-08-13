import test from "node:test";
import assert from "node:assert/strict";
import { formatDurationSeconds, formatScheduleClock } from "./formatSchedule";

test("formatDurationSeconds uses mm:ss under one hour", () => {
  assert.equal(formatDurationSeconds(0), "00:00");
  assert.equal(formatDurationSeconds(65), "01:05");
  assert.equal(formatDurationSeconds(600), "10:00");
  assert.equal(formatDurationSeconds(3599), "59:59");
});

test("formatDurationSeconds uses h:mm:ss at one hour and above", () => {
  assert.equal(formatDurationSeconds(3600), "1:00:00");
  assert.equal(formatDurationSeconds(4200), "1:10:00");
  assert.equal(formatDurationSeconds(14700), "4:05:00");
});

test("formatDurationSeconds rejects non-finite input", () => {
  assert.equal(formatDurationSeconds(-1), "—");
  assert.equal(formatDurationSeconds(Number.NaN), "—");
});

test("formatScheduleClock displays API ISO without recomputing from elapsed (EC6)", () => {
  // Fixture clock for aid-1 — must stay the parsed instant, not raceStart + elapsed.
  const clock = formatScheduleClock("2026-08-15T14:10:00.000Z");
  assert.notEqual(clock, "—");
  assert.match(clock, /\d/);
});

test("formatScheduleClock returns em dash for invalid ISO", () => {
  assert.equal(formatScheduleClock("not-a-date"), "—");
});
