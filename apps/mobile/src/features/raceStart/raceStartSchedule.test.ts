import test from "node:test";
import assert from "node:assert/strict";
import { defaultSuggestedRaceStartIso, listIanaTimeZones, normalizeRaceStartIso } from "./raceStartSchedule";

test("normalizeRaceStartIso accepts UTC zulu", () => {
  assert.equal(normalizeRaceStartIso("2026-07-12T13:00:00.000Z"), "2026-07-12T13:00:00.000Z");
});

test("listIanaTimeZones includes UTC", () => {
  const zones = listIanaTimeZones();
  assert.ok(zones.includes("UTC"));
  assert.ok(zones.length >= 5);
});

test("defaultSuggestedRaceStartIso returns valid instant", () => {
  const iso = defaultSuggestedRaceStartIso("America/Chicago");
  assert.ok(iso);
  assert.ok(normalizeRaceStartIso(iso));
});
