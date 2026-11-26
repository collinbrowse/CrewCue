import assert from "node:assert/strict";
import test from "node:test";
import { lag } from "./unrefreshed-age.mjs";

const HOUR = 3600;
const now = 1_000 * HOUR;

test("code merged since the last refresh is fine for a day", () => {
  const result = lag({
    codeTimes: [now - 2 * HOUR, now - 20 * HOUR],
    refreshTime: now - 90 * HOUR,
    now,
    maxHours: 30,
  });
  assert.equal(result.ok, true);
  assert.equal(result.hours, 20);
});

test("the oldest unrefreshed commit decides, not the newest", () => {
  const result = lag({
    codeTimes: [now - HOUR, now - 31 * HOUR],
    refreshTime: now - 40 * HOUR,
    now,
    maxHours: 30,
  });
  assert.equal(result.ok, false);
});

test("a quiet week then one merge is not an alarm", () => {
  assert.equal(
    lag({
      codeTimes: [now - HOUR],
      refreshTime: now - 200 * HOUR,
      now,
      maxHours: 30,
    }).ok,
    true,
  );
});

test("stale with no code commit after the refresh waits from the refresh", () => {
  assert.equal(
    lag({ codeTimes: [], refreshTime: now - 5 * HOUR, now, maxHours: 30 }).ok,
    true,
  );
  assert.equal(
    lag({ codeTimes: [], refreshTime: now - 31 * HOUR, now, maxHours: 30 }).ok,
    false,
  );
});
