import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
    { fileName: "c.gpx", ok: true, historyId: "h2", created: false }
  ];
  const summary = summarizeActivityGpxUploadBatch(results);
  assert.equal(summary.uploadedCount, 2);
  assert.equal(summary.failedCount, 1);
  assert.match(summary.message, /Uploaded 2 activities/);
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

test("parseActivityGpxMetrics reads fixture activity with timestamps", () => {
  const xml = readFileSync(
    resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../../../fixtures/pacing/activity-short-road.gpx"
    ),
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
