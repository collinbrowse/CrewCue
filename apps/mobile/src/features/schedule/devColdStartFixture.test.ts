import test from "node:test";
import assert from "node:assert/strict";
import {
  loadDevColdStartFixture,
  loadDevHistoryBackedFixture,
  shouldShowColdStartPrompt
} from "./devColdStartFixture";

test("EC1: DEV cold-start fixture has coldStart estimate + coarse finish clocks", () => {
  const pack = loadDevColdStartFixture();
  assert.equal(pack.estimate.coldStart, true);
  assert.equal(pack.estimate.historyRefIds, undefined);
  assert.match(pack.estimate.explanation, /cold start|No usable activity history/i);
  assert.equal(pack.sheet.pacingEstimateId, pack.estimate.id);
  assert.equal(pack.sheet.stops.at(-1)?.clockArrivalAt, pack.estimate.expectedFinishAt);
  assert.equal(pack.sheet.stops.at(-1)?.elapsedSeconds, pack.estimate.expectedFinishElapsedSeconds);
  assert.ok(shouldShowColdStartPrompt(pack.estimate));
});

test("EC5: history-backed fixture dismisses cold-start prompt", () => {
  const history = loadDevHistoryBackedFixture();
  assert.equal(history.estimate.coldStart, false);
  assert.ok((history.estimate.historyRefIds?.length ?? 0) > 0);
  assert.equal(shouldShowColdStartPrompt(history.estimate), false);
});

test("EC6: cold-start clocks are ISO-Z and displayable as API seconds", () => {
  const pack = loadDevColdStartFixture();
  assert.match(pack.estimate.expectedFinishAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.ok(Number.isInteger(pack.estimate.expectedFinishElapsedSeconds));
  for (const eta of pack.estimate.aidEtas) {
    assert.match(eta.clockArrivalAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.ok(Number.isInteger(eta.elapsedSeconds));
  }
});
