import test from "node:test";
import assert from "node:assert/strict";
import type { ActivityHistoryRef } from "@crewcue/contracts";
import {
  EMPTY_ESTIMATE_HISTORY_RECORD,
  decideEstimateRecompute,
  usableActivityHistory,
  usableHistoryFingerprint,
  type EstimateHistoryRecord
} from "./estimateRecompute";

function historyRow(overrides: Partial<ActivityHistoryRef> & { id: string }): ActivityHistoryRef {
  return {
    source: "gpx_upload",
    externalId: `ext-${overrides.id}`,
    recordedAt: "2026-06-01T14:00:00.000Z",
    ingestedAt: "2026-08-01T09:00:00.000Z",
    distanceMeters: 20000,
    elapsedSeconds: 10800,
    elevationGainMeters: 400,
    ...overrides
  };
}

test("usableActivityHistory keeps only rows with positive distance and elapsed", () => {
  const rows = [
    historyRow({ id: "a" }),
    historyRow({ id: "b", elapsedSeconds: undefined }),
    historyRow({ id: "c", distanceMeters: 0 }),
    historyRow({ id: "d", elapsedSeconds: 0 })
  ];
  assert.deepEqual(
    usableActivityHistory(rows).map((r) => r.id),
    ["a"]
  );
});

test("usableHistoryFingerprint is order-independent and ignores unusable rows", () => {
  const a = historyRow({ id: "a", distanceMeters: 20000, elapsedSeconds: 10800, elevationGainMeters: 400 });
  const b = historyRow({ id: "b", distanceMeters: 45000, elapsedSeconds: 21600, elevationGainMeters: 1800 });
  const noTs = historyRow({ id: "c", elapsedSeconds: undefined });
  assert.equal(usableHistoryFingerprint([a, b, noTs]), usableHistoryFingerprint([b, noTs, a]));
});

test("usableHistoryFingerprint changes when a new usable activity is added", () => {
  const a = historyRow({ id: "a" });
  const before = usableHistoryFingerprint([a]);
  const after = usableHistoryFingerprint([a, historyRow({ id: "b", distanceMeters: 45000, elapsedSeconds: 21600 })]);
  assert.notEqual(before, after);
});

const READY = {
  canEdit: true,
  busy: false,
  usableHistoryCount: 2,
  historyFingerprint: "fp-1"
} as const;

test("not ready (no edit / busy / no estimate / history unloaded) never recomputes and keeps record", () => {
  const record: EstimateHistoryRecord = { estimateId: "est-old", fingerprint: "fp-old" };
  for (const patch of [
    { canEdit: false },
    { busy: true },
    { estimateId: undefined },
    { historyFingerprint: undefined }
  ]) {
    const decision = decideEstimateRecompute({
      ...READY,
      estimateId: "est-1",
      coldStart: true,
      record,
      ...patch
    });
    assert.equal(decision.recompute, false);
    assert.equal(decision.reason, "none");
    assert.deepEqual(decision.nextRecord, record);
  }
});

test("cold-start estimate with usable history recomputes once on first observation", () => {
  const decision = decideEstimateRecompute({
    ...READY,
    estimateId: "est-cold",
    coldStart: true,
    record: EMPTY_ESTIMATE_HISTORY_RECORD
  });
  assert.equal(decision.recompute, true);
  assert.equal(decision.reason, "cold-start-with-history");
  assert.deepEqual(decision.nextRecord, { estimateId: "est-cold", fingerprint: "fp-1" });
});

test("cold-start estimate is not retried after a failed attempt recorded the fingerprint", () => {
  // Simulate: first observation recorded {est-cold, fp-1} but the recompute failed and the room
  // still holds the same cold-start estimate + same history.
  const decision = decideEstimateRecompute({
    ...READY,
    estimateId: "est-cold",
    coldStart: true,
    record: { estimateId: "est-cold", fingerprint: "fp-1" }
  });
  assert.equal(decision.recompute, false, "must not spin retrying a failed cold-start recompute");
  assert.equal(decision.reason, "none");
});

test("cold-start estimate with no usable history does not recompute", () => {
  const decision = decideEstimateRecompute({
    ...READY,
    usableHistoryCount: 0,
    historyFingerprint: "",
    estimateId: "est-cold",
    coldStart: true,
    record: EMPTY_ESTIMATE_HISTORY_RECORD
  });
  assert.equal(decision.recompute, false);
});

test("history-backed estimate adopts fingerprint on first observation, then recomputes on change", () => {
  // First observation of a history-backed estimate: adopt, no recompute.
  const adopt = decideEstimateRecompute({
    ...READY,
    estimateId: "est-hist",
    coldStart: false,
    record: EMPTY_ESTIMATE_HISTORY_RECORD
  });
  assert.equal(adopt.recompute, false);
  assert.deepEqual(adopt.nextRecord, { estimateId: "est-hist", fingerprint: "fp-1" });

  // Athlete uploads more history → fingerprint changes → recompute.
  const changed = decideEstimateRecompute({
    ...READY,
    historyFingerprint: "fp-2",
    estimateId: "est-hist",
    coldStart: false,
    record: adopt.nextRecord
  });
  assert.equal(changed.recompute, true);
  assert.equal(changed.reason, "history-changed");
  assert.deepEqual(changed.nextRecord, { estimateId: "est-hist", fingerprint: "fp-2" });
});

test("history-changed does not fire when history dropped to zero usable rows", () => {
  const decision = decideEstimateRecompute({
    ...READY,
    usableHistoryCount: 0,
    historyFingerprint: "",
    estimateId: "est-hist",
    coldStart: false,
    record: { estimateId: "est-hist", fingerprint: "fp-1" }
  });
  assert.equal(decision.recompute, false);
});

test("a newly attached estimate id resets the recorded fingerprint (no false change)", () => {
  // Estimate id changed (e.g. after a successful recompute); same history fingerprint.
  const decision = decideEstimateRecompute({
    ...READY,
    estimateId: "est-new",
    coldStart: false,
    record: { estimateId: "est-old", fingerprint: "fp-1" }
  });
  assert.equal(decision.recompute, false, "different estimate id means we have no recorded fp to compare");
  assert.deepEqual(decision.nextRecord, { estimateId: "est-new", fingerprint: "fp-1" });
});

test("stable history keeps returning none (loop-safe)", () => {
  let record: EstimateHistoryRecord = EMPTY_ESTIMATE_HISTORY_RECORD;
  for (let i = 0; i < 5; i += 1) {
    const decision = decideEstimateRecompute({
      ...READY,
      estimateId: "est-hist",
      coldStart: false,
      record
    });
    record = decision.nextRecord;
    assert.equal(decision.recompute, false);
  }
});
