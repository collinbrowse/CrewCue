import test from "node:test";
import assert from "node:assert/strict";
import type { CrewScheduleSheet, ScheduleStop } from "@crewcue/contracts";
import {
  buildAidStationPages,
  clampIndex,
  defaultIndexForPhase,
  followAfterUserPage,
  liveNextIndex,
  nextIndexIfFollow,
  peekArrival,
  peekKicker,
  peekStationStats,
  remainLabelFromSeconds,
  resolveLiveNextCheckpoint
} from "./aidStationPagerModel";

function stop(partial: Partial<ScheduleStop> & Pick<ScheduleStop, "checkpointId">): ScheduleStop {
  return {
    id: partial.id ?? `stop-${partial.checkpointId}`,
    checkpointId: partial.checkpointId,
    clockArrivalAt: partial.clockArrivalAt ?? "2026-08-15T14:10:00.000Z",
    elapsedSeconds: partial.elapsedSeconds ?? 600,
    plannedStoppageSeconds: partial.plannedStoppageSeconds ?? 120,
    delayOverrideSeconds: partial.delayOverrideSeconds,
    movingElapsedSeconds: partial.movingElapsedSeconds,
    notes: partial.notes
  };
}

test("clampIndex handles empty, bounds, and non-finite", () => {
  assert.equal(clampIndex(3, 0), 0);
  assert.equal(clampIndex(-1, 4), 0);
  assert.equal(clampIndex(99, 4), 3);
  assert.equal(clampIndex(1.9, 4), 1);
  assert.equal(clampIndex(Number.NaN, 4), 0);
});

test("buildAidStationPages prefers schedule stops over course checkpoints", () => {
  const sheet: CrewScheduleSheet = {
    roomId: "room-1",
    raceStartAt: "2026-08-15T14:00:00.000Z",
    stops: [stop({ checkpointId: "start" }), stop({ checkpointId: "aid-1" })]
  };
  const pages = buildAidStationPages({
    sheet,
    checkpoints: [
      { id: "start", title: "Start" },
      { id: "aid-1", title: "Aid 1" },
      { id: "extra", title: "Not on sheet" }
    ],
    titleByCheckpointId: new Map([
      ["start", "Start"],
      ["aid-1", "Aid 1"]
    ]),
    checkpointDistanceById: new Map([
      ["start", 0],
      ["aid-1", 5000]
    ])
  });
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.checkpointId, "start");
  assert.equal(pages[0]?.stop?.checkpointId, "start");
  assert.equal(pages[1]?.distanceMetersFromStart, 5000);
  assert.equal(pages[1]?.title, "Aid 1");
});

test("buildAidStationPages falls back to course checkpoints when schedule is empty", () => {
  const pages = buildAidStationPages({
    checkpoints: [{ id: "start", title: "Start", distanceMetersFromStart: 0, plannedStopSeconds: 0 }],
    titleByCheckpointId: new Map([["start", "START LINE"]])
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.title, "START LINE");
  assert.equal(pages[0]?.stop, undefined);
  assert.equal(pages[0]?.plannedStoppageSeconds, 0);
});

test("buildAidStationPages returns empty when no stops and no checkpoints", () => {
  assert.deepEqual(buildAidStationPages({}), []);
});

test("resolveLiveNextCheckpoint uses first uncrossed split", () => {
  const live = resolveLiveNextCheckpoint(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [
      { checkpointId: "a", distanceMetersFromStart: 0, crossedAtRecordedAt: "2026-08-15T14:01:00.000Z" },
      { checkpointId: "b", distanceMetersFromStart: 5000, crossedAtRecordedAt: null },
      { checkpointId: "c", distanceMetersFromStart: 10000, crossedAtRecordedAt: null }
    ],
    1000,
    new Map([
      ["a", 0],
      ["b", 5000],
      ["c", 10000]
    ])
  );
  assert.equal(live?.checkpointId, "b");
  assert.equal(live?.distanceMetersFromStart, 5000);
});

test("resolveLiveNextCheckpoint infers from distances when splits are missing", () => {
  const live = resolveLiveNextCheckpoint(
    [
      { id: "a", distanceMetersFromStart: 0 },
      { id: "b", distanceMetersFromStart: 8000 }
    ],
    [],
    100,
    new Map([
      ["a", 0],
      ["b", 8000]
    ])
  );
  assert.equal(live?.checkpointId, "b");
});

test("liveNextIndex is null when schedule pages omit the live checkpoint", () => {
  const pages = buildAidStationPages({
    sheet: {
      roomId: "r",
      raceStartAt: "2026-08-15T14:00:00.000Z",
      stops: [stop({ checkpointId: "only-aid" })]
    }
  });
  assert.equal(liveNextIndex(pages, { checkpointId: "missing" }), null);
  assert.equal(liveNextIndex(pages, { checkpointId: "only-aid" }), 0);
});

test("defaultIndexForPhase: preStart first, finish last, race follows live next", () => {
  assert.equal(defaultIndexForPhase("preStart", 5, 3), 0);
  assert.equal(defaultIndexForPhase("finish", 5, 0), 4);
  assert.equal(defaultIndexForPhase("race", 5, 2), 2);
  assert.equal(defaultIndexForPhase("race", 5, null), 0);
  assert.equal(defaultIndexForPhase("race", 0, 0), 0);
});

test("followAfterUserPage is true only on live next", () => {
  assert.equal(followAfterUserPage(2, 2), true);
  assert.equal(followAfterUserPage(4, 2), false);
  assert.equal(followAfterUserPage(0, null), false);
});

test("nextIndexIfFollow advances only while follow is on", () => {
  assert.equal(nextIndexIfFollow(true, 3, 1, 6), 3);
  assert.equal(nextIndexIfFollow(false, 3, 1, 6), 1);
  assert.equal(nextIndexIfFollow(true, null, 1, 6), 1);
  assert.equal(nextIndexIfFollow(false, 3, 9, 4), 3);
});

test("peekKicker prefers phase endpoints then NEXT then AID n", () => {
  assert.equal(peekKicker({ phase: "preStart", pageIndex: 0, pageCount: 4, liveNextIndex: 0 }), "START");
  assert.equal(peekKicker({ phase: "preStart", pageIndex: 2, pageCount: 4, liveNextIndex: 0 }), "AID 3");
  assert.equal(peekKicker({ phase: "finish", pageIndex: 3, pageCount: 4, liveNextIndex: 3 }), "FINISHED");
  assert.equal(peekKicker({ phase: "race", pageIndex: 1, pageCount: 4, liveNextIndex: 1 }), "NEXT");
  assert.equal(peekKicker({ phase: "race", pageIndex: 2, pageCount: 4, liveNextIndex: 1 }), "AID 3");
});

test("peekArrival uses schedule clock and does not recompute from elapsed", () => {
  const iso = "2026-08-15T14:10:00.000Z";
  const nowMs = Date.parse(iso) - 10 * 60 * 1000;
  const result = peekArrival({
    stop: stop({ checkpointId: "aid-1", clockArrivalAt: iso, elapsedSeconds: 99999 }),
    nowMs,
    fallback: { etaMs: nowMs + 3600 * 1000, remainSeconds: 3600 }
  });
  assert.equal(result.source, "schedule");
  assert.equal(result.remainLabel, "10M");
  assert.notEqual(result.clockLabel, "—");
});

test("peekArrival falls back to projection until schedule exists", () => {
  const nowMs = Date.UTC(2026, 7, 15, 14, 0, 0);
  const result = peekArrival({
    nowMs,
    fallback: { etaMs: nowMs + 8 * 60 * 1000, remainSeconds: 8 * 60 }
  });
  assert.equal(result.source, "projection");
  assert.equal(result.remainLabel, "8M");
});

test("remainLabelFromSeconds marks arrived and sub-minute", () => {
  assert.equal(remainLabelFromSeconds(-5), "DONE");
  assert.equal(remainLabelFromSeconds(0), "DONE");
  assert.equal(remainLabelFromSeconds(30), "< 1 min");
  assert.equal(remainLabelFromSeconds(Number.NaN), "—");
});

test("peekStationStats is station-centric", () => {
  const stats = peekStationStats({
    progressMeters: 1609.344,
    distanceMetersFromStart: 1609.344 * 3,
    plannedStoppageSeconds: 180,
    delayOverrideSeconds: 45
  });
  assert.equal(stats.distanceLabel, "2.0 MI");
  assert.equal(stats.stoppageLabel, "3m");
  assert.equal(stats.delayLabel, "00:45");
});
