import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { countActivityHistoryRows, resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { MAX_ACTIVITY_FILE_BYTES } from "../lib/activityFileHistory.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "activity-short-road.fit"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();
const base64Fixture = (name: string) => readFileSync(resolve(pacingDir, name)).toString("base64");

async function withApp(run: (app: ReturnType<typeof buildApp>, token: string) => Promise<void>): Promise<void> {
  await resetActivityHistoryStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    await run(app, app.jwt.sign({ sub: "athlete-file", teamIds: [], roomRoles: {} }));
  } finally {
    await app.close();
    await resetActivityHistoryStoreForTests();
  }
}

function post(app: ReturnType<typeof buildApp>, token: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/activity-history/file",
    headers: { authorization: `Bearer ${token}` },
    payload
  });
}

test("FIT and TCX fixtures import into pacing history with their own source", async () => {
  await withApp(async (app, token) => {
    const fit = await post(app, token, { fileName: "run.fit", contentBase64: base64Fixture("activity-short-road.fit") });
    assert.equal(fit.statusCode, 201);
    assert.equal(fit.json().source, "fit_upload");
    assert.equal(fit.json().elapsedSeconds, 2400);
    assert.equal(fit.json().recordedAt, "2026-05-10T15:30:00.000Z");
    assert.ok(Math.abs(fit.json().distanceMeters - 7991) < 1);

    const tcx = await post(app, token, { fileName: "run.tcx", contentBase64: base64Fixture("activity-short-road.tcx") });
    assert.equal(tcx.statusCode, 201);
    assert.equal(tcx.json().source, "tcx_upload");

    const gpx = await post(app, token, { fileName: "run.gpx", contentBase64: base64Fixture("activity-short-road.gpx") });
    assert.equal(gpx.statusCode, 201);
    assert.equal(gpx.json().source, "gpx_upload");

    const list = await app.inject({ method: "GET", url: "/activity-history", headers: { authorization: `Bearer ${token}` } });
    assert.equal(list.json().items.length, 3);
  });
});

test("importing the same file twice returns the stored row", async () => {
  await withApp(async (app, token) => {
    const payload = { fileName: "run.fit", contentBase64: base64Fixture("activity-short-road.fit") };
    const first = await post(app, token, payload);
    const second = await post(app, token, { ...payload, fileName: "renamed.fit" });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().id, first.json().id);
    assert.equal(await countActivityHistoryRows(), 1);
  });
});

test("treadmill FIT imports without a track", async () => {
  await withApp(async (app, token) => {
    const response = await post(app, token, { fileName: "tm.fit", contentBase64: base64Fixture("activity-treadmill.fit") });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().distanceMeters, 6000);
    assert.equal(response.json().elevationGainMeters, undefined);
  });
});

test("corrupt, unsupported and oversized files get clear errors and store nothing", async () => {
  await withApp(async (app, token) => {
    const corrupt = await post(app, token, { fileName: "bad.fit", contentBase64: base64Fixture("corrupt.fit") });
    assert.equal(corrupt.statusCode, 400);
    assert.equal(corrupt.json().code, "file_corrupt");
    assert.match(corrupt.json().error, /Couldn't read this FIT file/);

    const unsupported = await post(app, token, {
      fileName: "notes.txt",
      contentBase64: Buffer.from("not an activity").toString("base64")
    });
    assert.equal(unsupported.statusCode, 400);
    assert.equal(unsupported.json().code, "file_unsupported");

    const huge = await post(app, token, {
      fileName: "huge.fit",
      contentBase64: Buffer.alloc(MAX_ACTIVITY_FILE_BYTES + 3).toString("base64")
    });
    assert.equal(huge.statusCode, 413);
    assert.equal(huge.json().code, "file_too_large");
    assert.equal(await countActivityHistoryRows(), 0);
  });
});

test("rejects unauthenticated and cross-athlete imports", async () => {
  await withApp(async (app, token) => {
    const anon = await app.inject({ method: "POST", url: "/activity-history/file", payload: {} });
    assert.equal(anon.statusCode, 401);
    const other = await post(app, token, {
      fileName: "run.fit",
      contentBase64: base64Fixture("activity-short-road.fit"),
      athleteUserId: "someone-else"
    });
    assert.equal(other.statusCode, 403);
  });
});
