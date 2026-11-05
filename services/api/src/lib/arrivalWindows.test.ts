import test from "node:test";
import assert from "node:assert/strict";
import {
  arrivalWindow,
  setArrivalWindowTableForTests,
  sigmaTierFor,
  windowQuantiles,
  WINDOW_MIN_COVERAGE,
  WINDOW_PROGRESS_BANDS,
  type WindowBand,
  type WindowTable
} from "./arrivalWindows.js";
import { ARRIVAL_WINDOW_TABLE } from "./arrivalWindowTable.js";

/** A table where looser plans and earlier progress get wider windows, as real data should show. */
function sampleTable(overrides: Partial<WindowBand> & { drop?: (b: WindowBand) => boolean } = {}): WindowTable {
  const bands: WindowBand[] = [];
  const width = { coldStart: 0.3, coarseHistory: 0.2, similarHistory: 0.12 } as const;
  for (const target of ["next", "finish"] as const) {
    for (const [lo, hi] of WINDOW_PROGRESS_BANDS) {
      for (const tier of Object.keys(width) as Array<keyof typeof width>) {
        const spread = width[tier] * (1 - lo * 0.8) * (target === "finish" ? 1.5 : 1);
        bands.push({ target, progressLo: lo, progressHi: hi, sigmaTier: tier, hasHistory: false, q10: -spread, q90: spread, coverage: 0.8, samples: 100 });
      }
    }
  }
  const { drop, ...rest } = overrides;
  return { source: "test", bands: bands.filter((b) => !drop?.(b)).map((b) => ({ ...b, ...rest })) };
}

test("no table means no windows", () => {
  setArrivalWindowTableForTests(null);
  assert.equal(windowQuantiles({ target: "finish", seen: 0.5, planLogSigma: 0.12, hasHistory: false }), null);
  setArrivalWindowTableForTests(undefined);
});

test("the committed table covers every no-history band, clears the gate, and names its permitted source", () => {
  const table = ARRIVAL_WINDOW_TABLE!;
  assert.match(table.source, /OpenSplitTime.*permission/);
  assert.equal(table.bands.filter((b) => !b.hasHistory).length, 2 * 3 * 4);
  for (const band of table.bands) {
    assert.ok(band.coverage >= WINDOW_MIN_COVERAGE, `${band.target} ${band.sigmaTier} ${band.progressLo}`);
    assert.ok(band.q10 < 0 && band.q90 > 0, "a window always contains the ETA");
  }
  setArrivalWindowTableForTests(undefined);
  assert.ok(windowQuantiles({ target: "finish", seen: 0.5, planLogSigma: 0.12, hasHistory: false }));
  assert.equal(windowQuantiles({ target: "finish", seen: 0.5, planLogSigma: 0.12, hasHistory: true }), null, "history bands not fitted yet");
});

test("σ maps to the nearest tier", () => {
  assert.equal(sigmaTierFor(0.3), "coldStart");
  assert.equal(sigmaTierFor(0.21), "coarseHistory");
  assert.equal(sigmaTierFor(0.1), "similarHistory");
});

test("a window widens with plan σ and narrows as the race goes on", () => {
  const table = sampleTable();
  const width = (planLogSigma: number, seen: number) => {
    const w = arrivalWindow({ elapsedNow: 3600, etaElapsed: 3600 + 20_000, seen, planLogSigma, hasHistory: false, towardFinish: 1, table })!;
    return w.latestElapsedSeconds - w.earliestElapsedSeconds;
  };
  assert.ok(width(0.3, 0.3) > width(0.12, 0.3));
  assert.ok(width(0.12, 0.1) > width(0.12, 0.8));
});

test("windows always contain the ETA, and the next checkpoint needs only its own band", () => {
  const table = sampleTable({ drop: (b) => b.target === "finish" });
  const next = arrivalWindow({ elapsedNow: 0, etaElapsed: 5000, seen: 0.3, planLogSigma: 0.12, hasHistory: false, towardFinish: 0, table })!;
  assert.ok(next.earliestElapsedSeconds <= 5000 && next.latestElapsedSeconds >= 5000);
  assert.equal(
    arrivalWindow({ elapsedNow: 0, etaElapsed: 9000, seen: 0.3, planLogSigma: 0.12, hasHistory: false, towardFinish: 0.5, table }),
    null,
    "a later checkpoint without a finish band gets no window"
  );
});

test("a band under 70% held-out coverage is omitted", () => {
  const table = sampleTable({ coverage: 0.42 });
  assert.equal(windowQuantiles({ target: "next", seen: 0.1, planLogSigma: 0.3, hasHistory: false, table }), null);
});
