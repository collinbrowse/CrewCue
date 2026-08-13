import test from "node:test";
import assert from "node:assert/strict";
import { formatDurationSeconds, formatScheduleClock } from "./formatSchedule";
import { loadDevColdStartFixture, shouldShowColdStartPrompt } from "./devColdStartFixture";

test("EC1: cold-start panel inputs expose coarse finish labels", () => {
  const { estimate } = loadDevColdStartFixture();
  assert.ok(shouldShowColdStartPrompt(estimate));
  const clock = formatScheduleClock(estimate.expectedFinishAt);
  const elapsed = formatDurationSeconds(estimate.expectedFinishElapsedSeconds);
  assert.notEqual(clock, "—");
  assert.notEqual(elapsed, "—");
  assert.match(elapsed, /\d/);
});

test("EC5: non-coldStart estimate hides prompt helper", () => {
  const { estimate } = loadDevColdStartFixture();
  assert.equal(shouldShowColdStartPrompt({ ...estimate, coldStart: false }), false);
});
