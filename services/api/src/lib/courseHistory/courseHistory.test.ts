import test from "node:test";
import assert from "node:assert/strict";
import type { RaceCourse, RaceRoomProjectionCore } from "@crewcue/contracts";
import { COURSE_HISTORY_FORMAT_VERSION, type CourseHistoryEvent } from "./format.js";
import { aidCoverage, autoLinkEventIds, isLinkable, mapCheckpoints } from "./link.js";
import { buildCohort, cohortIsUsable, cohortPlanElapsed, pastRunnersElapsed, reshapeCurve } from "./cohort.js";
import { blendWithCohort, clearCourseHistoryCacheForTests, cohortForCourse } from "./resolve.js";
import {
  getCourseHistoryEvents,
  importCourseHistoryEvents,
  listCourseHistoryEvents,
  resetCourseHistoryForTests,
  usageFor,
  type StoredCourseHistoryEvent
} from "./store.js";

const LAT0 = 40;
const DEG = 1 / 111_195;
const at = (m: number) => ({ latitude: LAT0 + m * DEG, longitude: -105 });

function room(opts: { titles?: string[] } = {}): RaceCourse {
  const titles = opts.titles ?? ["Start", "Aid 1", "Aid 2", "Finish"];
  const d = [0, 15_000, 30_000, 50_000];
  return {
    checkpoints: titles.map((title, i) => ({
      id: `cp${i}`,
      title,
      ...at(d[i]!),
      distanceMetersFromStart: d[i]!,
      ...(i > 0 && i < titles.length - 1 ? { tags: ["aid"] } : {})
    })),
    derivedMetrics: { canonicalDistanceMeters: 50_000, elevationGainMeters: 0, elevationLossMeters: 0, elevationSource: "none" }
  } as RaceCourse;
}

/** `finishers` runners whose pace scales from 0.8× to 1.2×; checkpoints with or without positions. */
function event(id: string, finishers: number, opts: { located?: boolean; source?: CourseHistoryEvent["source"]; names?: string[] } = {}): CourseHistoryEvent {
  const names = opts.names ?? ["Start", "Aid 1", "Aid 2", "Finish"];
  const d = [0, 15_100, 29_900, 50_200];
  const share = [0, 0.27, 0.58, 1]; // slower second half
  return {
    formatVersion: COURSE_HISTORY_FORMAT_VERSION,
    source: opts.source ?? "file",
    sourceEventId: id,
    name: `Race ${id}`,
    startTime: "2025-06-01T06:00:00Z",
    checkpoints: names.map((name, i) => ({
      id: `e${i}`,
      name,
      distanceMeters: d[i]!,
      ...(opts.located === false ? {} : at(d[i]!))
    })),
    efforts: Array.from({ length: finishers }, (_, r) => {
      const finish = 20_000 * (0.8 + (0.4 * r) / Math.max(1, finishers - 1));
      return { splits: share.slice(1).map((s, i) => ({ checkpointId: `e${i + 1}`, inSeconds: Math.round(s * finish) })) };
    })
  };
}

function stored(e: CourseHistoryEvent, usage: StoredCourseHistoryEvent["usage"] = "product"): StoredCourseHistoryEvent {
  return { id: `${e.source}:${e.sourceEventId}`, usage, importedAt: "2026-01-01T00:00:00Z", event: e };
}

test("usage comes from the source list (default: only crewcue feeds the product)", () => {
  const before = process.env.COURSE_HISTORY_PRODUCT_SOURCES;
  try {
    delete process.env.COURSE_HISTORY_PRODUCT_SOURCES;
    assert.equal(usageFor("crewcue"), "product");
    assert.equal(usageFor("file"), "backtest_only");
    process.env.COURSE_HISTORY_PRODUCT_SOURCES = "crewcue,file";
    assert.equal(usageFor("file"), "product");
  } finally {
    if (before === undefined) delete process.env.COURSE_HISTORY_PRODUCT_SOURCES;
    else process.env.COURSE_HISTORY_PRODUCT_SOURCES = before;
  }
});

test("import round-trips, re-import replaces, and a bad file stores nothing", async () => {
  resetCourseHistoryForTests();
  await importCourseHistoryEvents([event("a", 3)]);
  await importCourseHistoryEvents([event("a", 5)]);
  const [row] = await getCourseHistoryEvents(["file:a"]);
  assert.equal(row!.event.efforts.length, 5);
  assert.equal(row!.usage, "backtest_only");
  const bad = event("b", 2);
  bad.efforts[0]!.splits.reverse();
  await assert.rejects(importCourseHistoryEvents([event("c", 2), bad]), /nothing stored/);
  assert.equal((await listCourseHistoryEvents()).length, 1, "neither c nor b was stored");
});

test("checkpoints map by position, then name, then share of the course", () => {
  const course = room();
  assert.deepEqual([...mapCheckpoints(course, event("x", 1)).values()], ["e0", "e1", "e2", "e3"]);
  const byName = mapCheckpoints(course, event("x", 1, { located: false }));
  assert.equal(byName.get("cp1"), "e1");
  const byShare = mapCheckpoints(room({ titles: ["Start", "Sky Pond", "Lake", "Finish"] }), event("x", 1, { located: false }));
  assert.equal(byShare.get("cp1"), "e1", "15 km vs 15.1 km of 50 km is within 2%");
});

test("a link needs 80% of the aid checkpoints mapped", () => {
  const course = room();
  const half = event("x", 1, { located: false, names: ["Start", "Somewhere", "Aid 2", "Finish"] });
  half.checkpoints[1]!.distanceMeters = 5_000; // 10% of the course: neither name nor share maps it
  assert.equal(aidCoverage(course, mapCheckpoints(course, half)), 0.5);
  assert.equal(isLinkable(course, half), false);
});

test("auto-link: one layout links (all years); different layouts are ambiguous", () => {
  const course = room();
  const years = [stored(event("2024", 30)), stored(event("2025", 30))];
  assert.deepEqual(autoLinkEventIds(course, years), ["file:2024", "file:2025"]);
  const other = stored(event("alt", 30, { names: ["Start", "Aid 1", "Aid 2b", "Finish"] }));
  assert.deepEqual(autoLinkEventIds(course, [...years, other]), []);
  const far = event("far", 30);
  far.checkpoints[0]!.latitude = 41;
  assert.deepEqual(autoLinkEventIds(course, [stored(far)]), []);
});

test("the cohort needs 25 product finishers; backtest-only events never count", () => {
  const course = room();
  assert.equal(cohortIsUsable(buildCohort(course, [stored(event("a", 24))])), false);
  assert.equal(cohortIsUsable(buildCohort(course, [stored(event("a", 25))])), true);
  assert.equal(buildCohort(course, [stored(event("a", 40), "backtest_only")]).arrivals.length, 0);
});

test("plan shape follows past finishers of similar planned finish", () => {
  const cohort = buildCohort(room(), [stored(event("a", 40))]);
  const planned = cohortPlanElapsed(cohort, 20_000);
  assert.ok(Math.abs(planned[1]! / 20_000 - 0.27) < 0.01);
  assert.ok(Math.abs(planned[2]! / 20_000 - 0.58) < 0.01);
  assert.equal(planned[3], 20_000);
});

test("past-runners estimate scales by the runner's elapsed and needs 4 matches", () => {
  const cohort = buildCohort(room(), [stored(event("a", 40))]);
  const finish = pastRunnersElapsed(cohort, 1, 3, 0.27 * 20_000)!;
  assert.ok(Math.abs(finish - 20_000) < 200, `finish ${finish}`);
  assert.equal(pastRunnersElapsed(cohort, 1, 3, 50 * 20_000), null, "nobody that slow");
});

test("reshaping a plan curve passes through the anchors and keeps order", () => {
  const curve = Array.from({ length: 11 }, (_, i) => ({ distanceMetersFromStart: i * 5000, referenceElapsedSeconds: i * 1800 }));
  const out = reshapeCurve(curve, [
    { distanceMeters: 0, elapsedSeconds: 0 },
    { distanceMeters: 25_000, elapsedSeconds: 7000 },
    { distanceMeters: 50_000, elapsedSeconds: 18_000 }
  ]);
  assert.equal(out[5]!.referenceElapsedSeconds, 7000);
  assert.equal(out[10]!.referenceElapsedSeconds, 18_000);
  assert.ok(out.every((p, i) => i === 0 || p.referenceElapsedSeconds > out[i - 1]!.referenceElapsedSeconds));
});

test("live blend averages the projection with past finishers from the last checkpoint", () => {
  const cohort = buildCohort(room(), [stored(event("a", 40))]);
  const start = Date.parse("2026-06-01T06:00:00Z");
  const core = {
    etaFinishPlanIso: new Date(start + 24_000 * 1000).toISOString(),
    checkpointSplits: [
      { checkpointId: "cp0", actualElapsedSecondsAtCross: 0 },
      { checkpointId: "cp1", actualElapsedSecondsAtCross: 0.27 * 20_000 },
      { checkpointId: "cp2", actualElapsedSecondsAtCross: null },
      { checkpointId: "cp3", actualElapsedSecondsAtCross: null }
    ],
    remainingCheckpointEtas: [
      { checkpointId: "cp2", liveProjectedElapsedSeconds: 14_000, frozenPlanElapsedSeconds: 11_600, deltaSecondsVsFrozenPlan: 0 },
      { checkpointId: "cp3", liveProjectedElapsedSeconds: 24_000, frozenPlanElapsedSeconds: 20_000, deltaSecondsVsFrozenPlan: 0 }
    ]
  } as unknown as RaceRoomProjectionCore;
  const blended = blendWithCohort(core, cohort, start);
  const finish = blended.remainingCheckpointEtas!.find((e) => e.checkpointId === "cp3")!;
  assert.ok(Math.abs(finish.liveProjectedElapsedSeconds - (24_000 + 20_000) / 2) < 200);
  assert.equal(Date.parse(blended.etaFinishPlanIso), start + finish.liveProjectedElapsedSeconds * 1000);
  // Before the first cohort checkpoint, nothing changes.
  const early = { ...core, checkpointSplits: core.checkpointSplits.map((r, i) => (i === 1 ? { ...r, actualElapsedSecondsAtCross: null } : r)) };
  assert.equal(blendWithCohort(early as RaceRoomProjectionCore, cohort, start), early);
});

test("cohortForCourse: an operator link to backtest-only data gives no cohort", async () => {
  resetCourseHistoryForTests();
  clearCourseHistoryCacheForTests();
  await importCourseHistoryEvents([event("file-only", 40)]);
  assert.equal(await cohortForCourse(room(), ["file:file-only"]), null);
  await importCourseHistoryEvents([event("ours", 40, { source: "crewcue" })]);
  clearCourseHistoryCacheForTests();
  assert.ok(await cohortForCourse(room()), "a crewcue event auto-links");
});

test("the pre-race estimate follows the cohort's checkpoint shares only with the tuned flag", async () => {
  const { estimatePacingMicroModelWithArtifacts } = await import("../pacingEstimate/microModel/microModelEstimator.js");
  const course = room();
  const cohort = buildCohort(course, [stored(event("a", 40))]);
  const routeMetricPoints = Array.from({ length: 501 }, (_, i) => ({ ...at(i * 100), elevationMeters: 1600 }));
  const input = {
    raceStartAt: "2026-06-01T12:00:00.000Z",
    checkpoints: course.checkpoints,
    history: [],
    routeMetricPoints,
    courseLengthMeters: 50_000,
    courseHistoryCohort: cohort
  };
  const before = process.env.PROJECTION_TUNED_CONSTANTS;
  try {
    delete process.env.PROJECTION_TUNED_CONSTANTS;
    const off = estimatePacingMicroModelWithArtifacts(input).estimate;
    process.env.PROJECTION_TUNED_CONSTANTS = "1";
    const on = estimatePacingMicroModelWithArtifacts(input).estimate;
    const share = (est: typeof on, id: string) => est.aidEtas.find((a) => a.checkpointId === id)!.elapsedSeconds / est.expectedFinishElapsedSeconds;
    assert.ok(Math.abs(share(on, "cp1") - 0.27) < 0.01, `on ${share(on, "cp1")}`);
    assert.ok(Math.abs(share(on, "cp2") - 0.58) < 0.01);
    assert.ok(Math.abs(share(off, "cp1") - 0.27) > 0.02, "flag off keeps the GPX shape");
    assert.match(on.explanation, /40 past finishers/);
  } finally {
    if (before === undefined) delete process.env.PROJECTION_TUNED_CONSTANTS;
    else process.env.PROJECTION_TUNED_CONSTANTS = before;
  }
});
