import assert from "node:assert/strict";
import test from "node:test";
import { parsePacingEstimate, type PacingEstimate } from "@crewcue/contracts";
import {
  getPacingEstimateById,
  resetPacingEstimateStoreForTests,
  savePacingEstimate
} from "./pacingEstimateStore.js";

function buildEstimate(overrides: Partial<PacingEstimate> = {}): PacingEstimate {
  return parsePacingEstimate({
    id: "est_store_default",
    coldStart: true,
    expectedFinishAt: "2026-08-15T20:00:00.000Z",
    expectedFinishElapsedSeconds: 25_200,
    aidEtas: [
      {
        checkpointId: "aid-1",
        clockArrivalAt: "2026-08-15T15:00:00.000Z",
        elapsedSeconds: 7200
      }
    ],
    explanation: "Store test estimate.",
    ...overrides
  });
}

test("pacing estimate store returns undefined for missing ids and resets rows", async () => {
  await resetPacingEstimateStoreForTests();
  assert.equal(await getPacingEstimateById("est_missing"), undefined);

  const estimate = buildEstimate({ id: "est_reset" });
  await savePacingEstimate("athlete-reset", estimate);
  assert.equal((await getPacingEstimateById("est_reset"))?.athleteUserId, "athlete-reset");

  await resetPacingEstimateStoreForTests();
  assert.equal(await getPacingEstimateById("est_reset"), undefined);
});

test("pacing estimate store replaces same id owner and payload", async () => {
  await resetPacingEstimateStoreForTests();
  const first = buildEstimate({
    id: "est_replace",
    explanation: "Original estimate."
  });
  const replacement = buildEstimate({
    id: "est_replace",
    coldStart: false,
    expectedFinishAt: "2026-08-15T19:30:00.000Z",
    expectedFinishElapsedSeconds: 23_400,
    aidEtas: [
      {
        checkpointId: "aid-2",
        clockArrivalAt: "2026-08-15T16:30:00.000Z",
        elapsedSeconds: 12_600
      }
    ],
    explanation: "Replacement estimate.",
    historyRefIds: ["hist-long-trail"]
  });

  await savePacingEstimate("athlete-original", first);
  await savePacingEstimate("athlete-replacement", replacement);

  assert.deepEqual(await getPacingEstimateById("est_replace"), {
    athleteUserId: "athlete-replacement",
    estimate: replacement
  });
});

test("pacing estimate store rejects invalid replacement without clobbering existing row", async () => {
  await resetPacingEstimateStoreForTests();
  const existing = buildEstimate({
    id: "est_reject_invalid",
    explanation: "Existing valid estimate."
  });
  await savePacingEstimate("athlete-existing", existing);

  const invalidReplacement = {
    ...existing,
    expectedFinishElapsedSeconds: -1
  } as unknown as PacingEstimate;

  await assert.rejects(
    () => savePacingEstimate("athlete-invalid", invalidReplacement),
    /expectedFinishElapsedSeconds must be a non-negative finite number of seconds/
  );
  assert.deepEqual(await getPacingEstimateById("est_reject_invalid"), {
    athleteUserId: "athlete-existing",
    estimate: existing
  });
});
