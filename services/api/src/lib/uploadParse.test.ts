import test from "node:test";
import assert from "node:assert/strict";
import { ActivityFileError } from "@crewcue/map-core";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "./activityHistoryStore.js";
import { GpxActivityParseError } from "./gpxActivityHistory.js";
import {
  parseUploadInWorker,
  setUploadParseTimeoutMsForTests,
  UPLOAD_PARSE_TIMEOUT_MESSAGE,
  UploadParseLimitError
} from "./uploadParse.js";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test">
  <trk><name>Worker run</name><trkseg>
    <trkpt lat="37.780000" lon="-122.420000"><time>2026-05-10T15:30:00Z</time></trkpt>
    <trkpt lat="37.782000" lon="-122.420000"><time>2026-05-10T15:35:00Z</time></trkpt>
    <trkpt lat="37.784000" lon="-122.420000"><time>2026-05-10T15:40:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

test("worker parse returns the same metrics and course preview as an in-process parse", async () => {
  const metrics = await parseUploadInWorker({ kind: "gpxActivity", gpxXml: GPX });
  assert.ok(metrics.distanceMeters > 400);
  assert.equal(metrics.recordedAt, "2026-05-10T15:30:00.000Z");
  assert.equal(metrics.elapsedSeconds, 600);

  const file = await parseUploadInWorker({ kind: "activityFile", bytes: new TextEncoder().encode(GPX), fileName: "run.gpx" });
  assert.equal(file.source, "gpx_upload");
  assert.equal(file.name, "Worker run");

  const preview = await parseUploadInWorker({ kind: "coursePreview", gpxXml: GPX, courseFileName: "route.gpx" });
  assert.equal(preview.courseFileName, "route.gpx");
  assert.ok(preview.course.checkpoints.length >= 2);
});

test("worker parse errors come back as the parser's own error types", async () => {
  await assert.rejects(
    parseUploadInWorker({ kind: "gpxActivity", gpxXml: "<gpx></gpx>" }),
    (err: unknown) => err instanceof GpxActivityParseError && err.code === "gpx_empty"
  );
  await assert.rejects(
    parseUploadInWorker({ kind: "activityFile", bytes: new TextEncoder().encode("hello"), fileName: "notes.txt" }),
    (err: unknown) => err instanceof ActivityFileError && err.code === "file_unsupported"
  );
  await assert.rejects(
    parseUploadInWorker({ kind: "coursePreview", gpxXml: "<gpx></gpx>", courseFileName: "route.gpx" }),
    (err: unknown) => err instanceof Error && /at least two track points/.test(err.message)
  );
});

test("a parse past the time limit stops its worker and rejects with file_parse_timeout", async () => {
  setUploadParseTimeoutMsForTests(1);
  try {
    await assert.rejects(
      parseUploadInWorker({ kind: "gpxActivity", gpxXml: GPX }),
      (err: unknown) => err instanceof UploadParseLimitError && err.code === "file_parse_timeout"
    );
  } finally {
    setUploadParseTimeoutMsForTests();
  }
  // The next parse gets a fresh worker and the default limit.
  const metrics = await parseUploadInWorker({ kind: "gpxActivity", gpxXml: GPX });
  assert.ok(metrics.distanceMeters > 0);
});

test("upload routes answer 422 file_parse_timeout when a parse runs past the time limit", async () => {
  await resetActivityHistoryStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    const token = app.jwt.sign({ sub: "owner-parse-limit", teamIds: ["team-1"], roomRoles: {} });
    const headers = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/race-rooms",
      headers,
      payload: { teamId: "team-1", athleteId: "owner-parse-limit", name: "Parse limit", creatorRole: "team_manager" }
    });
    assert.equal(created.statusCode, 201);
    const roomId = (created.json() as { id: string }).id;

    const requests = [
      { url: "/activity-history/gpx", payload: { gpxXml: GPX } },
      {
        url: "/activity-history/file",
        payload: { fileName: "run.gpx", contentBase64: Buffer.from(GPX).toString("base64") }
      },
      { url: `/race-rooms/${roomId}/course/gpx-preview`, payload: { gpxXml: GPX, courseFileName: "route.gpx" } }
    ];

    setUploadParseTimeoutMsForTests(1);
    try {
      for (const { url, payload } of requests) {
        const response = await app.inject({ method: "POST", url, headers, payload });
        assert.equal(response.statusCode, 422, url);
        assert.deepEqual(response.json(), { error: UPLOAD_PARSE_TIMEOUT_MESSAGE, code: "file_parse_timeout" }, url);
      }
    } finally {
      setUploadParseTimeoutMsForTests();
    }

    for (const { url, payload } of requests) {
      const response = await app.inject({ method: "POST", url, headers, payload });
      assert.ok([200, 201].includes(response.statusCode), `${url} ${response.statusCode} ${response.body}`);
    }
  } finally {
    await app.close();
    await resetActivityHistoryStoreForTests();
  }
});
