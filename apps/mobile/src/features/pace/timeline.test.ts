import assert from "node:assert/strict";
import test from "node:test";
import type { RaceCheckpointSplitRow } from "@crewcue/contracts";
import {
  formatElapsedHoursMinutes,
  formatSignedHoursMinutesDelta,
  paceRailCheckpointRowModel,
  paceRailFinishRowModel,
  paceRemainingVsPlanDisplay
} from "./timeline";

test("paceRailCheckpointRowModel: upcoming inactive row keeps marker at top", () => {
  const cum = [1000, 5000, 9000];
  const m = paceRailCheckpointRowModel(2, 1, 3, cum, 2000, undefined, 600, Date.now(), false);
  assert.equal(m.isActiveLeg, false);
  assert.equal(m.fraction01, 0);
});

test("paceRailCheckpointRowModel: past inactive row pins marker to bottom", () => {
  const cum = [1000, 5000, 9000];
  const m = paceRailCheckpointRowModel(1, 2, 3, cum, 2000, undefined, 600, Date.now(), false);
  assert.equal(m.isActiveLeg, false);
  assert.equal(m.fraction01, 1);
});

test("paceRailCheckpointRowModel: departed checkpoint pins to bottom when focus has advanced", () => {
  const cum = [1000, 5000];
  const m = paceRailCheckpointRowModel(0, 1, 2, cum, 3000, undefined, 600, Date.now(), true);
  assert.equal(m.isActiveLeg, false);
  assert.equal(m.fraction01, 1);
});

test("paceRailCheckpointRowModel: approach leg uses along-course distances", () => {
  const cum = [1000, 5000];
  const m = paceRailCheckpointRowModel(1, 1, 2, cum, 3000, undefined, 600, Date.now(), false);
  assert.equal(m.isActiveLeg, true);
  assert.ok(Math.abs(m.fraction01 - 0.5) < 0.0001);
});

test("paceRailCheckpointRowModel: dwell uses arrival vs now", () => {
  const nowMs = Date.parse("2026-01-01T12:05:00.000Z");
  const arrival = "2026-01-01T12:00:00.000Z";
  const split: RaceCheckpointSplitRow = {
    checkpointId: "cp",
    distanceMetersFromStart: 5000,
    crossedAtRecordedAt: null,
    plannedElapsedSecondsAtCross: 0,
    actualElapsedSecondsAtCross: null,
    deltaSecondsAtCross: null,
    plannedStopSeconds: 600,
    visits: [
      {
        visitIndex: 0,
        resolvedSource: "auto",
        activeActualStopSeconds: null,
        autoDetected: {
          arrivalRecordedAt: arrival,
          departureRecordedAt: null,
          firstSlowedAt: arrival,
          actualStopSeconds: null
        }
      }
    ],
    totalActualStopSeconds: null,
    deltaStopSeconds: null
  };
  const cum = [1000, 5000];
  const m = paceRailCheckpointRowModel(1, 1, 2, cum, 3000, split, 600, nowMs, false);
  assert.equal(m.isActiveLeg, true);
  assert.ok(Math.abs(m.fraction01 - 0.5) < 0.0001);
});

test("paceRailFinishRowModel: last leg to finish", () => {
  const m = paceRailFinishRowModel(2, 2, 5000, 10_000, 7500);
  assert.equal(m.isActiveLeg, true);
  assert.equal(m.fraction01, 0.5);
});

test("formatElapsedHoursMinutes: hours and minutes, minutes-only, seconds edge", () => {
  assert.equal(formatElapsedHoursMinutes(33_780), "9h 23m");
  assert.equal(formatElapsedHoursMinutes(7200), "2h");
  assert.equal(formatElapsedHoursMinutes(2700), "45m");
  assert.equal(formatElapsedHoursMinutes(0), "0m");
  assert.equal(formatElapsedHoursMinutes(45), "45s");
  assert.equal(formatElapsedHoursMinutes(NaN), "—");
});

test("formatSignedHoursMinutesDelta: sign and rounding", () => {
  assert.equal(formatSignedHoursMinutesDelta(7500), "+2h 5m");
  assert.equal(formatSignedHoursMinutesDelta(-2700), "-45m");
  assert.equal(formatSignedHoursMinutesDelta(-7200), "-2h");
  assert.equal(formatSignedHoursMinutesDelta(0), "0m");
});

test("paceRemainingVsPlanDisplay: slower plus, faster minus, on plan +- 0min within 1m", () => {
  assert.deepEqual(paceRemainingVsPlanDisplay(90), { kind: "slower", label: "+2m" });
  assert.deepEqual(paceRemainingVsPlanDisplay(-120), { kind: "faster", label: "-2m" });
  assert.deepEqual(paceRemainingVsPlanDisplay(20), { kind: "on", label: "+- 0min" });
  assert.deepEqual(paceRemainingVsPlanDisplay(0), { kind: "on", label: "+- 0min" });
  assert.deepEqual(paceRemainingVsPlanDisplay(60), { kind: "on", label: "+- 0min" });
  assert.deepEqual(paceRemainingVsPlanDisplay(-60), { kind: "on", label: "+- 0min" });
  assert.deepEqual(paceRemainingVsPlanDisplay(61), { kind: "slower", label: "+1m" });
  assert.deepEqual(paceRemainingVsPlanDisplay(-61), { kind: "faster", label: "-1m" });
  assert.deepEqual(paceRemainingVsPlanDisplay(3600), { kind: "slower", label: "+1h" });
  assert.deepEqual(paceRemainingVsPlanDisplay(-3900), { kind: "faster", label: "-1h 5m" });
});
