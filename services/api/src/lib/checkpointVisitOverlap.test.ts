import test from "node:test";
import assert from "node:assert/strict";
import { findOverlappingCheckpointVisit, intervalsOverlap } from "./checkpointVisitOverlap.js";

test("intervalsOverlap detects inclusive overlap", () => {
  assert.equal(intervalsOverlap(0, 10, 10, 20), true);
  assert.equal(intervalsOverlap(0, 10, 11, 20), false);
  assert.equal(intervalsOverlap(5, 15, 0, 10), true);
});

test("findOverlappingCheckpointVisit matches auto-detected windows", () => {
  const visits = [
    {
      visitIndex: 1,
      autoDetected: {
        arrivalRecordedAt: "2026-05-12T16:01:00.000Z",
        departureRecordedAt: "2026-05-12T16:03:00.000Z"
      }
    }
  ];
  const hit = findOverlappingCheckpointVisit(
    visits,
    Date.parse("2026-05-12T16:02:00.000Z"),
    Date.parse("2026-05-12T16:04:00.000Z")
  );
  assert.equal(hit?.visitIndex, 1);
});

test("findOverlappingCheckpointVisit matches prior manualEntry (retry / lease reclaim)", () => {
  const visits = [
    {
      visitIndex: 1,
      manualEntry: {
        arrivalAt: "2026-05-12T16:01:10.000Z",
        departureAt: "2026-05-12T16:04:10.000Z"
      }
    }
  ];
  const sameWindow = findOverlappingCheckpointVisit(
    visits,
    Date.parse("2026-05-12T16:01:10.000Z"),
    Date.parse("2026-05-12T16:04:10.000Z")
  );
  assert.equal(sameWindow?.visitIndex, 1);

  const overlapping = findOverlappingCheckpointVisit(
    visits,
    Date.parse("2026-05-12T16:03:00.000Z"),
    Date.parse("2026-05-12T16:05:00.000Z")
  );
  assert.equal(overlapping?.visitIndex, 1);

  const disjoint = findOverlappingCheckpointVisit(
    visits,
    Date.parse("2026-05-12T16:05:00.000Z"),
    Date.parse("2026-05-12T16:06:00.000Z")
  );
  assert.equal(disjoint, undefined);
});
