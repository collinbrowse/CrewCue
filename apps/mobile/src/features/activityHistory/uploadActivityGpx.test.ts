import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activityHistoryNextStepHint,
  activityUploadProgressRatio,
  formatActivityUploadNetworkError,
  formatActivityUploadProgress,
  looksLikeGpxXml,
  parseActivityGpxMetrics,
  summarizeActivityGpxUploadBatch,
  type ActivityGpxUploadFileResult
} from "./uploadActivityGpx";

test("looksLikeGpxXml accepts GPX root and rejects empty/other", () => {
  assert.equal(looksLikeGpxXml('<gpx version="1.1"></gpx>'), true);
  assert.equal(looksLikeGpxXml("  \n<GPX xmlns=\"http://www.topografix.com/GPX/1/1\">"), true);
  assert.equal(looksLikeGpxXml(""), false);
  assert.equal(looksLikeGpxXml("<kml></kml>"), false);
});

test("summarizeActivityGpxUploadBatch reports mixed success", () => {
  const results: ActivityGpxUploadFileResult[] = [
    { fileName: "a.gpx", ok: true, historyId: "h1", created: true },
    { fileName: "b.gpx", ok: false, message: "GPX file is empty" },
    { fileName: "c.gpx", ok: true, historyId: "h2", created: false, skippedDuplicate: true }
  ];
  const summary = summarizeActivityGpxUploadBatch(results);
  assert.equal(summary.uploadedCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.match(summary.message, /Uploaded 1 activity/);
  assert.match(summary.message, /Skipped 1 duplicate/);
  assert.match(summary.message, /b\.gpx: GPX file is empty/);
});

test("summarizeActivityGpxUploadBatch uses count for multiple failures", () => {
  const summary = summarizeActivityGpxUploadBatch([
    { fileName: "a.gpx", ok: false, message: "empty" },
    { fileName: "b.gpx", ok: false, message: "corrupt" }
  ]);
  assert.equal(summary.failedCount, 2);
  assert.match(summary.message, /2 failed/);
});

test("summarizeActivityGpxUploadBatch includes single failure detail", () => {
  const summary = summarizeActivityGpxUploadBatch([
    { fileName: "bad.gpx", ok: false, message: "corrupt" }
  ]);
  assert.equal(summary.uploadedCount, 0);
  assert.equal(summary.failedCount, 1);
  assert.match(summary.message, /bad\.gpx: corrupt/);
});

test("summarizeActivityGpxUploadBatch empty list", () => {
  const summary = summarizeActivityGpxUploadBatch([]);
  assert.equal(summary.uploadedCount, 0);
  assert.equal(summary.message, "No files uploaded");
});

test("parseActivityGpxMetrics ignores planned rtept when a recorded trk exists", () => {
  const recorded = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk><trkseg>
    <trkpt lat="37.78" lon="-122.42"><time>2026-05-10T15:30:00Z</time></trkpt>
    <trkpt lat="37.85" lon="-122.42"><time>2026-05-10T16:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const mixed = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <rte>
    <rtept lat="39.15" lon="-120.25"></rtept>
    <rtept lat="39.60" lon="-120.25"></rtept>
  </rte>
  <trk><trkseg>
    <trkpt lat="37.78" lon="-122.42"><time>2026-05-10T15:30:00Z</time></trkpt>
    <trkpt lat="37.85" lon="-122.42"><time>2026-05-10T16:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const trackMetrics = parseActivityGpxMetrics(recorded);
  const mixedMetrics = parseActivityGpxMetrics(mixed);
  assert.equal(mixedMetrics.elapsedSeconds, trackMetrics.elapsedSeconds);
  assert.ok(Math.abs(mixedMetrics.distanceMeters - trackMetrics.distanceMeters) < 1);
});

test("parseActivityGpxMetrics reads fixture activity with timestamps", () => {
  const hereDir = resolve(fileURLToPath(import.meta.url), "..");
  const xml = readFileSync(
    resolve(hereDir, "../../../../../fixtures/pacing/activity-short-road.gpx"),
    "utf8"
  );
  const metrics = parseActivityGpxMetrics(xml);
  assert.ok(metrics.distanceMeters > 0);
  assert.ok((metrics.elapsedSeconds ?? 0) > 0);
  assert.ok(metrics.recordedAt);
});

test("formatActivityUploadNetworkError maps RN fetch failure", () => {
  assert.match(
    formatActivityUploadNetworkError(new Error("Network request failed")) ?? "",
    /could not reach the API/i
  );
  assert.equal(formatActivityUploadNetworkError(new Error("other")), undefined);
});

test("formatActivityUploadProgress names stages and batch position", () => {
  assert.equal(formatActivityUploadProgress({ stage: "picking" }), "Waiting for file selection…");
  assert.match(
    formatActivityUploadProgress({
      stage: "parsing",
      fileName: "long.gpx",
      fileIndex: 2,
      fileCount: 3
    }),
    /Parsing GPX “long\.gpx” \(2 of 3\)/
  );
  assert.equal(
    formatActivityUploadProgress({ stage: "uploading", fileName: "a.gpx", fileIndex: 1, fileCount: 1 }),
    "Sending metrics “a.gpx” (1 of 1)…"
  );
  assert.equal(formatActivityUploadProgress({ stage: "refreshing" }), "Refreshing activity history…");
});

test("activityUploadProgressRatio advances across stages and files", () => {
  const pick = activityUploadProgressRatio({ stage: "picking" });
  const read1 = activityUploadProgressRatio({
    stage: "reading",
    fileIndex: 1,
    fileCount: 2,
    fileName: "a.gpx"
  });
  const parseStart = activityUploadProgressRatio({
    stage: "parsing",
    fileIndex: 1,
    fileCount: 2,
    fileName: "a.gpx",
    stageRatio: 0
  });
  const parseMid = activityUploadProgressRatio({
    stage: "parsing",
    fileIndex: 1,
    fileCount: 2,
    fileName: "a.gpx",
    stageRatio: 0.5
  });
  const parseEnd = activityUploadProgressRatio({
    stage: "parsing",
    fileIndex: 1,
    fileCount: 2,
    fileName: "a.gpx",
    stageRatio: 1
  });
  const read2 = activityUploadProgressRatio({
    stage: "reading",
    fileIndex: 2,
    fileCount: 2,
    fileName: "b.gpx"
  });
  const refresh = activityUploadProgressRatio({ stage: "refreshing" });
  assert.ok(pick < read1);
  assert.ok(read1 <= parseStart);
  assert.ok(parseStart < parseMid);
  assert.ok(parseMid < parseEnd);
  assert.ok(parseEnd <= read2);
  assert.ok(read2 < refresh);
  assert.ok(refresh < 1);
});

test("activityHistoryNextStepHint only when history exists", () => {
  assert.equal(activityHistoryNextStepHint(0), undefined);
  assert.match(activityHistoryNextStepHint(4) ?? "", /open Pace/i);
});

test("formatActivityUploadProgress omits inline parse percent (bar owns %)", () => {
  assert.equal(
    formatActivityUploadProgress({
      stage: "parsing",
      fileName: "long.gpx",
      fileIndex: 1,
      fileCount: 1,
      stageRatio: 0.42
    }),
    "Parsing GPX “long.gpx” (1 of 1)…"
  );
});
