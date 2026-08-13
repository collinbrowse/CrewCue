import test from "node:test";
import assert from "node:assert/strict";
import { loadDevScheduleFixtureSheet } from "./devScheduleFixture";

test("DEV schedule fixture parses schedule-expected.json with delay stop (EC1/EC5)", () => {
  const sheet = loadDevScheduleFixtureSheet();
  assert.equal(sheet.roomId, "room-fixture-50k");
  assert.ok(sheet.stops.length >= 3);
  const withDelay = sheet.stops.find((s) => s.checkpointId === "aid-2");
  assert.equal(withDelay?.delayOverrideSeconds, 120);
  assert.equal(withDelay?.clockArrivalAt, "2026-08-15T15:20:00.000Z");
  const withoutDelay = sheet.stops.find((s) => s.checkpointId === "aid-1");
  assert.equal(withoutDelay?.delayOverrideSeconds, undefined);
});
