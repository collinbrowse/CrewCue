/**
 * Unit tests for cutoff instant resolution + status bands (W4-1 / #408).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CUTOFF_WARN_MARGIN_SECONDS } from "@crewcue/contracts";
import {
  classifyCutoffMargin,
  compareProjectedArrivalToCutoff,
  cutoffInstantMs
} from "./cutoffWarning.js";

const RACE_START_MS = Date.parse("2026-08-15T13:00:00.000Z");

test("time_of_day uses UTC race-day wall clock of raceStartAt", () => {
  const ms = cutoffInstantMs({ mode: "time_of_day", hour: 17, minute: 30 }, RACE_START_MS);
  assert.equal(ms, Date.parse("2026-08-15T17:30:00.000Z"));
});

test("time_of_day earlier than race start stays on the same UTC race day", () => {
  const ms = cutoffInstantMs({ mode: "time_of_day", hour: 7, minute: 45 }, RACE_START_MS);
  assert.equal(ms, Date.parse("2026-08-15T07:45:00.000Z"));
});

test("elapsed_from_start adds seconds to raceStartAt", () => {
  const ms = cutoffInstantMs({ mode: "elapsed_from_start", seconds: 14_400 }, RACE_START_MS);
  assert.equal(ms, Date.parse("2026-08-15T17:00:00.000Z"));
});

test("absent cutoff yields undefined instant and warning", () => {
  assert.equal(cutoffInstantMs(undefined, RACE_START_MS), undefined);
  assert.equal(
    compareProjectedArrivalToCutoff({
      cutoff: undefined,
      raceStartAtMs: RACE_START_MS,
      clockArrivalAtMs: RACE_START_MS + 3600_000
    }),
    undefined
  );
});

test("classifyCutoffMargin bands: ok / warn / breach", () => {
  assert.equal(classifyCutoffMargin(CUTOFF_WARN_MARGIN_SECONDS + 1), "ok");
  assert.equal(classifyCutoffMargin(CUTOFF_WARN_MARGIN_SECONDS), "warn");
  assert.equal(classifyCutoffMargin(1), "warn");
  assert.equal(classifyCutoffMargin(0), "breach");
  assert.equal(classifyCutoffMargin(-30), "breach");
});

test("compareProjectedArrivalToCutoff returns margin and status", () => {
  const under = compareProjectedArrivalToCutoff({
    cutoff: { mode: "elapsed_from_start", seconds: 10_000 },
    raceStartAtMs: RACE_START_MS,
    clockArrivalAtMs: RACE_START_MS + 8_000 * 1000
  });
  assert.deepEqual(under, { cutoffStatus: "ok", cutoffMarginSeconds: 2000 });

  const warn = compareProjectedArrivalToCutoff({
    cutoff: { mode: "time_of_day", hour: 14, minute: 0 },
    raceStartAtMs: RACE_START_MS,
    clockArrivalAtMs: Date.parse("2026-08-15T13:50:00.000Z")
  });
  assert.deepEqual(warn, { cutoffStatus: "warn", cutoffMarginSeconds: 600 });

  const earlierSameDayBreach = compareProjectedArrivalToCutoff({
    cutoff: { mode: "time_of_day", hour: 7, minute: 45 },
    raceStartAtMs: RACE_START_MS,
    clockArrivalAtMs: RACE_START_MS + 30 * 60 * 1000
  });
  assert.deepEqual(earlierSameDayBreach, {
    cutoffStatus: "breach",
    cutoffMarginSeconds: -20_700
  });

  const breach = compareProjectedArrivalToCutoff({
    cutoff: { mode: "elapsed_from_start", seconds: 3600 },
    raceStartAtMs: RACE_START_MS,
    clockArrivalAtMs: RACE_START_MS + 3600 * 1000
  });
  assert.deepEqual(breach, { cutoffStatus: "breach", cutoffMarginSeconds: 0 });
});
