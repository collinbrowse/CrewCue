import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import {
  countActivityHistoryRows,
  listActivityHistoryForAthlete,
  resetActivityHistoryStoreForTests,
  upsertActivityHistory
} from "../lib/activityHistoryStore.js";
import { fingerprintActivityFile, MAX_ACTIVITY_FILE_BYTES } from "../lib/activityFileHistory.js";

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

test("a dense FIT with cadence stores a grade profile the API keeps to itself", async () => {
  await withApp(async (app, token) => {
    const res = await post(app, token, { fileName: "hill.fit", contentBase64: base64Fixture("activity-hill-run.fit") });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().gradeProfile, undefined);

    const [stored] = await listActivityHistoryForAthlete("athlete-file");
    const profile = stored?.gradeProfile;
    assert.ok(profile);
    assert.equal(profile.labelSource, "cadence");
    assert.equal(profile.quality, "high");
    const hikeMeters = profile.bins.reduce((sum, bin) => sum + bin.hikeMeters, 0);
    const hikeGrade = profile.bins.reduce((sum, bin) => sum + bin.hikeMeters * bin.gradePercent, 0) / hikeMeters;
    assert.ok(Math.abs(hikeMeters - 800) <= 25, `hike meters ${hikeMeters}`);
    assert.ok(Math.abs(hikeGrade - 14) <= 1, `hike grade ${hikeGrade}`);
    // The 90 s stop isn't moving time: 1000/3 + 800/1 + 1000/3.4 ≈ 1427 s.
    assert.ok(Math.abs(profile.movingSeconds - 1427) <= 15, `moving ${profile.movingSeconds}`);

    const list = await app.inject({ method: "GET", url: "/activity-history", headers: { authorization: `Bearer ${token}` } });
    assert.equal(list.json().items[0].gradeProfile, undefined);
  });
});

test("sparse files import without a grade profile", async () => {
  await withApp(async (app, token) => {
    const res = await post(app, token, { fileName: "run.fit", contentBase64: base64Fixture("activity-short-road.fit") });
    assert.equal(res.statusCode, 201);
    const [stored] = await listActivityHistoryForAthlete("athlete-file");
    assert.equal(stored?.gradeProfile, undefined);
  });
});

test("re-importing a file stored before grade profiles backfills it on the same row", async () => {
  await withApp(async (app, token) => {
    const bytes = readFileSync(resolve(pacingDir, "activity-hill-run.fit"));
    const old = await upsertActivityHistory("athlete-file", {
      id: "old-row",
      source: "fit_upload",
      externalId: fingerprintActivityFile(new Uint8Array(bytes)),
      recordedAt: "2026-05-17T14:00:00.000Z",
      ingestedAt: "2026-05-18T00:00:00.000Z",
      distanceMeters: 2800,
      elapsedSeconds: 1517
    });
    assert.equal(old.created, true);

    const res = await post(app, token, { fileName: "hill.fit", contentBase64: bytes.toString("base64") });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().id, "old-row");
    assert.equal(await countActivityHistoryRows(), 1);
    const [stored] = await listActivityHistoryForAthlete("athlete-file");
    assert.equal(stored?.id, "old-row");
    assert.ok(stored?.gradeProfile);
  });
});

test("a named file keeps its name; files without one (FIT fixture) have none", async () => {
  await withApp(async (app, token) => {
    const gpx = await post(app, token, { fileName: "run.gpx", contentBase64: base64Fixture("activity-short-road.gpx") });
    assert.equal(gpx.statusCode, 201);
    assert.equal(gpx.json().name, "Short road 8k history");
    const fit = await post(app, token, { fileName: "run.fit", contentBase64: base64Fixture("activity-short-road.fit") });
    assert.equal(fit.json().name, undefined);
    const list = await app.inject({ method: "GET", url: "/activity-history", headers: { authorization: `Bearer ${token}` } });
    const names = list.json().items.map((item: { source: string; name?: string }) => [item.source, item.name ?? null]);
    assert.deepEqual(names.sort(), [["fit_upload", null], ["gpx_upload", "Short road 8k history"]]);
  });
});

test("re-importing a named file stored before names backfills the name on the same row", async () => {
  await withApp(async (app, token) => {
    const bytes = readFileSync(resolve(pacingDir, "activity-short-road.gpx"));
    await upsertActivityHistory("athlete-file", {
      id: "unnamed-row",
      source: "gpx_upload",
      externalId: fingerprintActivityFile(new Uint8Array(bytes)),
      recordedAt: "2026-05-10T15:30:00.000Z",
      ingestedAt: "2026-05-11T00:00:00.000Z",
      distanceMeters: 7991
    });
    const res = await post(app, token, { fileName: "road.gpx", contentBase64: bytes.toString("base64") });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().id, "unnamed-row");
    assert.equal(res.json().name, "Short road 8k history");
    const [stored] = await listActivityHistoryForAthlete("athlete-file");
    assert.equal(stored?.name, "Short road 8k history");
  });
});
