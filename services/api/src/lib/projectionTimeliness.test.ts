import test from "node:test";
import assert from "node:assert/strict";
import { STALENESS_MAX_SECONDS, getStalenessThresholdSeconds, attachProjectionTimeliness } from "./projectionTimeliness.js";

test("getStalenessThresholdSeconds uses env fallback when no client interval", async (t) => {
  const prev = process.env.PROJECTION_STALE_AFTER_SECONDS;
  t.after(() => {
    if (prev === undefined) {
      delete process.env.PROJECTION_STALE_AFTER_SECONDS;
    } else {
      process.env.PROJECTION_STALE_AFTER_SECONDS = prev;
    }
  });
  delete process.env.PROJECTION_STALE_AFTER_SECONDS;
  assert.equal(getStalenessThresholdSeconds(undefined), STALENESS_MAX_SECONDS);
  process.env.PROJECTION_STALE_AFTER_SECONDS = "90";
  assert.equal(getStalenessThresholdSeconds(undefined), 90);
});

test("getStalenessThresholdSeconds derives from upload interval with bounds", () => {
  assert.equal(getStalenessThresholdSeconds(60), 180);
  assert.equal(getStalenessThresholdSeconds(10), 30);
  assert.equal(getStalenessThresholdSeconds(900), STALENESS_MAX_SECONDS);
});

test("attachProjectionTimeliness respects derived threshold", () => {
  const core = {
    roomId: "r1",
    asOfPingId: "p1",
    asOfRecordedAt: "2026-04-16T12:00:00.000Z",
    progressMeters: 0,
    courseLengthMeters: 1000,
    plannedPaceSecondsPerKm: 600,
    etaFinishPlanIso: "2026-04-16T13:00:00.000Z",
    checkpointSplits: [],
    stoppageSummary: {
      totalPlannedStopSeconds: 0,
      totalActualStopSeconds: 0,
      totalDeltaStopSeconds: null,
      stoppageTimePercent: null,
      remainingPlannedStopSeconds: 0
    }
  };
  const recordedAtMs = Date.parse("2026-04-16T12:00:00.000Z");
  const evaluatedAtMs = recordedAtMs + 181_000;
  const view = attachProjectionTimeliness(core, recordedAtMs, evaluatedAtMs, 60);
  assert.equal(view.stalenessThresholdSeconds, 180);
  assert.equal(view.projectionConfidence, "degraded");
});
