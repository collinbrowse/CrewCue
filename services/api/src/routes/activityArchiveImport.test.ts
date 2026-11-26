import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, gzipSync } from "node:zlib";
import { buildApp } from "../app.js";
import {
  countActivityHistoryRows,
  listActivityHistoryForAthlete,
  resetActivityHistoryStoreForTests
} from "../lib/activityHistoryStore.js";
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { runInFreshProcess } from "../lib/testFreshProcess.js";
import { readZipEntries, ZipArchiveError } from "../lib/zipArchive.js";
import { resetUploadJobsForTests, settleUploadJobsForTests } from "../lib/uploadJobs.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "activity-short-road.fit"))) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}
const pacingDir = findPacingFixturesDir();
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(pacingDir, name)));

/** Minimal zip writer for tests: deflated entries (stored when `store`). CRCs are left 0; the reader doesn't check them. */
function zip(entries: Array<{ name: string; bytes: Uint8Array; store?: boolean; encrypted?: boolean }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.store ? Buffer.from(entry.bytes) : deflateRawSync(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.encrypted ? 1 : 0, 6);
    local.writeUInt16LE(entry.store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.encrypted ? 1 : 0, 8);
    central.writeUInt16LE(entry.store ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, eocd]));
}

async function withApp(run: (app: ReturnType<typeof buildApp>, token: string) => Promise<void>): Promise<void> {
  await resetActivityHistoryStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    await run(app, app.jwt.sign({ sub: "athlete-archive", teamIds: [], roomRoles: {} }));
  } finally {
    await settleUploadJobsForTests();
    resetUploadJobsForTests();
    await app.close();
    await resetActivityHistoryStoreForTests();
  }
}

function post(app: ReturnType<typeof buildApp>, token: string | null, url: string, fileName: string, bytes: Uint8Array) {
  return app.inject({
    method: "POST",
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: { fileName, contentBase64: Buffer.from(bytes).toString("base64") }
  });
}

const mixedZip = () =>
  zip([
    { name: "runs/hill.fit", bytes: fixture("activity-short-road.fit") },
    { name: "runs/road.gpx", bytes: fixture("activity-short-road.gpx"), store: true },
    { name: "README.txt", bytes: new TextEncoder().encode("hi") },
    { name: "__MACOSX/runs/._hill.fit", bytes: new Uint8Array([0, 1]) },
    { name: "runs/broken.fit", bytes: fixture("corrupt.fit") }
  ]);

test("preview reads one file without saving, and marks it once imported", async () => {
  await withApp(async (app, token) => {
    const first = await post(app, token, "/activity-history/preview", "run.fit", fixture("activity-short-road.fit"));
    assert.equal(first.statusCode, 200);
    const [run] = first.json().runs;
    assert.equal(run.source, "fit_upload");
    assert.equal(run.alreadyImported, false);
    assert.ok(Math.abs(run.distanceMeters - 7991) < 1);
    assert.ok(run.track.length >= 2 && run.track.length <= 200);
    assert.equal(await countActivityHistoryRows(), 0);

    await post(app, token, "/activity-history/file", "run.fit", fixture("activity-short-road.fit"));
    const again = await post(app, token, "/activity-history/preview", "run.fit", fixture("activity-short-road.fit"));
    assert.equal(again.json().runs[0].alreadyImported, true);
  });
});

test("preview of a .zip lists its runs and what it couldn't read", async () => {
  await withApp(async (app, token) => {
    const res = await post(app, token, "/activity-history/preview", "export.zip", mixedZip());
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(
      body.runs.map((run: { fileName: string }) => run.fileName),
      ["hill.fit", "road.gpx"]
    );
    assert.deepEqual(
      body.unreadable.map((row: { fileName: string }) => row.fileName).sort(),
      ["README.txt", "broken.fit"]
    );
    assert.equal(await countActivityHistoryRows(), 0);
  });
});

test("archive imports each run once, and a replay saves nothing new", async () => {
  await withApp(async (app, token) => {
    const first = await post(app, token, "/activity-history/archive", "export.zip", mixedZip());
    assert.equal(first.statusCode, 201);
    assert.equal(first.json().saved, 2);
    assert.equal(first.json().duplicates, 0);
    assert.equal(first.json().unreadable.length, 2);
    assert.equal(first.json().items[0].gradeProfile, undefined);

    const replay = await post(app, token, "/activity-history/archive", "export.zip", mixedZip());
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().saved, 0);
    assert.equal(replay.json().duplicates, 2);
    assert.equal(await countActivityHistoryRows(), 2);
  });
});

test("archive and preview refuse bad uploads and strangers", async () => {
  await withApp(async (app, token) => {
    const corrupt = await post(app, token, "/activity-history/archive", "export.zip", mixedZip().subarray(0, 200));
    assert.equal(corrupt.statusCode, 400);
    const big = await post(app, token, "/activity-history/preview", "big.zip", new Uint8Array(21 * 1024 * 1024));
    assert.equal(big.statusCode, 413);
    const anon = await post(app, null, "/activity-history/preview", "run.fit", fixture("activity-short-road.fit"));
    assert.equal(anon.statusCode, 401);
    assert.equal(await countActivityHistoryRows(), 0);
  });
});

test("zip reader refuses password-protected archives and caps entries", () => {
  const bytes = new TextEncoder().encode("x");
  assert.throws(
    () => readZipEntries(zip([{ name: "a.fit", bytes, encrypted: true }]), { maxEntries: 5, maxEntryBytes: 100, maxTotalBytes: 100 }),
    (err: unknown) => err instanceof ZipArchiveError && /password/.test(err.message)
  );
  assert.throws(
    () =>
      readZipEntries(zip([1, 2, 3].map((n) => ({ name: `${n}.fit`, bytes }))), {
        maxEntries: 2,
        maxEntryBytes: 100,
        maxTotalBytes: 100
      }),
    (err: unknown) => err instanceof ZipArchiveError && /more than 2/.test(err.message)
  );
});

test("rides in a .zip are listed as not runs and never imported", async () => {
  await withApp(async (app, token) => {
    const upload = zip([
      { name: "run.fit", bytes: fixture("activity-short-road.fit") },
      { name: "ride.fit", bytes: fixture("activity-ride.fit") }
    ]);
    const preview = await post(app, token, "/activity-history/preview", "export.zip", upload);
    assert.deepEqual(
      preview.json().runs.map((run: { fileName: string }) => run.fileName),
      ["run.fit"]
    );
    assert.deepEqual(preview.json().unreadable, []);
    assert.deepEqual(preview.json().skipped, { older: 0, notRun: 1, unreadable: 0 });
    const imported = await post(app, token, "/activity-history/archive", "export.zip", upload);
    assert.equal(imported.json().saved, 1);
    assert.equal(await countActivityHistoryRows(), 1);
  });
});

function startRaw(app: ReturnType<typeof buildApp>, token: string | null, mode: string, fileName: string, bytes: Uint8Array) {
  return app.inject({
    method: "POST",
    url: `/activity-history/upload?mode=${mode}&fileName=${encodeURIComponent(fileName)}`,
    headers: { "content-type": "application/zip", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: Buffer.from(bytes)
  });
}

function pollJob(app: ReturnType<typeof buildApp>, token: string, jobId: string) {
  return app.inject({
    method: "GET",
    url: `/activity-history/upload-jobs/${jobId}`,
    headers: { authorization: `Bearer ${token}` }
  });
}

/** Upload, then poll the job until it finishes: the finished response. */
async function postRaw(app: ReturnType<typeof buildApp>, token: string, mode: string, fileName: string, bytes: Uint8Array) {
  const started = await startRaw(app, token, mode, fileName, bytes);
  assert.equal(started.statusCode, 202);
  const { jobId } = started.json() as { jobId: string };
  for (;;) {
    const res = await pollJob(app, token, jobId);
    if (res.statusCode !== 202) return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("raw upload previews and imports a .zip, keeping a year before the newest run", async () => {
  await withApp(async (app, token) => {
    // short-road is 2026-05-10, hill-run 2026-05-17: both inside the year. A copy of short-road
    // dated two years earlier falls outside it.
    const old = new TextDecoder()
      .decode(fixture("activity-short-road.gpx"))
      .replace(/2026-05-10/g, "2024-05-10");
    const upload = zip([
      { name: "a/short.fit", bytes: fixture("activity-short-road.fit") },
      { name: "a/hill.fit", bytes: fixture("activity-hill-run.fit") },
      { name: "a/old.gpx", bytes: new TextEncoder().encode(old) },
      { name: "a/ride.fit", bytes: fixture("activity-ride.fit") },
      { name: "a/notes.txt", bytes: new TextEncoder().encode("x") }
    ]);
    const preview = await postRaw(app, token, "preview", "export.zip", upload);
    assert.equal(preview.statusCode, 200);
    const body = preview.json();
    assert.deepEqual(
      body.runs.map((run: { fileName: string }) => run.fileName),
      ["hill.fit", "short.fit"]
    );
    assert.deepEqual(body.skipped, { older: 1, notRun: 1, unreadable: 1 });
    assert.ok(body.runs.every((run: { track: unknown[] }) => run.track.length === 0));
    assert.equal(await countActivityHistoryRows(), 0);

    const imported = await postRaw(app, token, "import", "export.zip", upload);
    assert.equal(imported.statusCode, 201);
    assert.equal(imported.json().saved, 2);
    assert.equal(await countActivityHistoryRows(), 2);
  });
});

test("raw upload takes more than the JSON limit and refuses bad requests", async () => {
  await withApp(async (app, token) => {
    // 25 MB of stored padding beside one run: over the 20 MB JSON limit, inside the raw one.
    const big = zip([
      { name: "run.fit", bytes: fixture("activity-short-road.fit") },
      { name: "padding.bin", bytes: new Uint8Array(25 * 1024 * 1024), store: true }
    ]);
    const res = await postRaw(app, token, "preview", "big.zip", big);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().runs.length, 1);
    assert.equal((await startRaw(app, token, "nope", "big.zip", big)).statusCode, 400);
    assert.equal((await startRaw(app, null, "preview", "big.zip", big)).statusCode, 401);
  });
});

test("upload jobs: corrupt zips fail in the job and jobs are private", async () => {
  await withApp(async (app, token) => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const failed = await postRaw(app, token, "preview", "bad.zip", corrupt);
    assert.equal(failed.statusCode, 400);
    assert.equal(failed.json().code, "file_corrupt");

    const upload = zip([{ name: "run.fit", bytes: fixture("activity-short-road.fit") }]);
    const second = (await startRaw(app, token, "preview", "b.zip", upload)).json().jobId as string;
    await settleUploadJobsForTests();
    assert.equal((await pollJob(app, token, second)).statusCode, 200);
    const other = app.jwt.sign({ sub: "someone-else", teamIds: [], roomRoles: {} });
    assert.equal((await pollJob(app, other, second)).statusCode, 404);

    const stranger = await app.inject({ method: "GET", url: `/activity-history/upload-jobs/${second}` });
    assert.equal(stranger.statusCode, 401);
    assert.equal((await pollJob(app, token, "missing")).statusCode, 404);
  });
});

test(
  "a bulk-imported watch export survives an API restart: same runs, the old job is gone, a re-share saves nothing new",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 120_000 },
  async () => {
    const athlete = "athlete-archive-restart";
    const upload = zip([
      { name: "export/short.fit", bytes: fixture("activity-short-road.fit") },
      { name: "export/hill.fit", bytes: fixture("activity-hill-run.fit") },
      { name: "export/ride.fit", bytes: fixture("activity-ride.fit") }
    ]);
    await resetActivityHistoryStoreForTests();
    let jobId = "";
    let imported: Array<{ id: string; externalId: string; recordedAt: string; distanceMeters: number }> = [];
    // Not `withApp`: its cleanup truncates the rows the restart must read back.
    const app = buildApp();
    await app.ready();
    try {
      const token = app.jwt.sign({ sub: athlete, teamIds: [], roomRoles: {} });
      const started = await startRaw(app, token, "import", "export.zip", upload);
      assert.equal(started.statusCode, 202, started.body);
      jobId = (started.json() as { jobId: string }).jobId;
      await settleUploadJobsForTests();
      const done = await pollJob(app, token, jobId);
      assert.equal(done.statusCode, 201, done.body);
      assert.equal(done.json().saved, 2);
      const list = await app.inject({ method: "GET", url: "/activity-history", headers: { authorization: `Bearer ${token}` } });
      imported = list.json().items;
      assert.equal(imported.length, 2);
    } finally {
      await settleUploadJobsForTests();
      resetUploadJobsForTests();
      await app.close();
    }

    const after = runInFreshProcess<{
      oldJob: { status: number; body: { code?: string } };
      list: { status: number; body: { items: typeof imported } };
      preview: { status: number; body: { runs: Array<{ fileName: string; alreadyImported: boolean }> } };
      reimport: { status: number; body: { saved: number; duplicates: number; items: Array<{ id: string }> } };
      estimate: { status: number; body: { checkpoints?: unknown[] } };
    }>(
      `
      const { buildApp } = await import(process.argv[1]);
      const [athlete, oldJobId, zipBase64, idsJson, checkpointsJson] = process.argv.slice(2);
      const app = buildApp();
      await app.ready();
      const headers = { authorization: "Bearer " + app.jwt.sign({ sub: athlete, teamIds: [], roomRoles: {} }) };
      const send = async (opts) => {
        const res = await app.inject({ ...opts, headers: { ...headers, ...(opts.headers ?? {}) } });
        return { status: res.statusCode, body: res.json() };
      };
      const raw = async (mode) => {
        const started = await send({
          method: "POST",
          url: "/activity-history/upload?mode=" + mode + "&fileName=export.zip",
          headers: { "content-type": "application/zip" },
          payload: Buffer.from(zipBase64, "base64")
        });
        if (started.status !== 202) return started;
        for (;;) {
          const res = await send({ method: "GET", url: "/activity-history/upload-jobs/" + started.body.jobId });
          if (res.status !== 202) return res;
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      const out = {};
      out.oldJob = await send({ method: "GET", url: "/activity-history/upload-jobs/" + oldJobId });
      out.list = await send({ method: "GET", url: "/activity-history" });
      out.preview = await raw("preview");
      out.reimport = await raw("import");
      out.estimate = await send({
        method: "POST",
        url: "/pacing-estimates",
        payload: {
          raceStartAt: "2026-08-15T13:00:00.000Z",
          checkpoints: JSON.parse(checkpointsJson),
          historyRefIds: JSON.parse(idsJson)
        }
      });
      process.stdout.write("\\nRESULT:" + JSON.stringify(out) + "\\n");
      await app.close();
      process.exit(0);
      `,
      [
        athlete,
        jobId,
        Buffer.from(upload).toString("base64"),
        JSON.stringify(imported.map((run) => run.id)),
        JSON.stringify(load50kCourseWithAids().checkpoints)
      ]
    );

    // The phone polling a job from before the restart is told to share again, not left spinning.
    assert.equal(after.oldJob.status, 404);
    assert.equal(after.oldJob.body.code, "upload_not_found");
    // The runner's history comes back from Postgres: same rows, ids and order.
    assert.equal(after.list.status, 200);
    assert.deepEqual(after.list.body.items, imported);
    // Sharing the same export again: every run shows Already imported, and importing saves nothing.
    assert.equal(after.preview.status, 200);
    assert.deepEqual(
      after.preview.body.runs.map((run) => [run.fileName, run.alreadyImported]),
      [
        ["hill.fit", true],
        ["short.fit", true]
      ]
    );
    assert.equal(after.reimport.status, 200, JSON.stringify(after.reimport.body));
    assert.equal(after.reimport.body.saved, 0);
    assert.equal(after.reimport.body.duplicates, 2);
    assert.deepEqual(after.reimport.body.items.map((run) => run.id).sort(), imported.map((run) => run.id).sort());
    // The pace estimate still finds every imported run by id.
    assert.equal(after.estimate.status, 200, JSON.stringify(after.estimate.body));
    // The hill run kept the grade profile the pace model reads, and nothing was duplicated.
    assert.equal(await countActivityHistoryRows(), 2);
    const stored = await listActivityHistoryForAthlete(athlete);
    assert.equal(stored.filter((run) => run.gradeProfile !== undefined).length, 1);
    await resetActivityHistoryStoreForTests();
  }
);

test("a Strava export's gzipped FIT and TCX import with their own source, and GPX names are kept", async () => {
  await withApp(async (app, token) => {
    // Strava's bulk export keeps each original upload as `<id>.fit.gz` / `<id>.tcx.gz`; only the
    // activities Strava wrote itself are plain `.gpx`. Before, every `.gz` was skipped as unreadable,
    // so a mixed export imported only its GPX runs.
    const hill = fixture("activity-hill-run.fit");
    const tcx = new TextDecoder()
      .decode(fixture("activity-short-road.tcx"))
      .replace(/2026-05-10/g, "2026-05-12")
      .replace(/<Id>/, "<Notes>Tempo Tuesday</Notes>\n      <Id>");
    const gpx = new TextDecoder().decode(fixture("activity-short-road.gpx")).replace(/2026-05-10/g, "2026-05-14");
    const upload = zip([
      { name: "export_1/activities/101.fit.gz", bytes: new Uint8Array(gzipSync(hill)) },
      { name: "export_1/activities/102.tcx.gz", bytes: new Uint8Array(gzipSync(new TextEncoder().encode(tcx))) },
      { name: "export_1/activities/103.gpx", bytes: new TextEncoder().encode(gpx) },
      { name: "export_1/activities.csv", bytes: new TextEncoder().encode("Activity ID,Activity Name") }
    ]);
    const preview = await postRaw(app, token, "preview", "export_1.zip", upload);
    assert.equal(preview.statusCode, 200);
    const runs = preview.json().runs as Array<{ fileName: string; source: string; name?: string }>;
    assert.deepEqual(
      runs.map((run) => [run.fileName, run.source, run.name ?? null]),
      [
        ["101.fit.gz", "fit_upload", null],
        ["103.gpx", "gpx_upload", "Short road 8k history"],
        ["102.tcx.gz", "tcx_upload", "Tempo Tuesday"]
      ]
    );
    assert.deepEqual(preview.json().skipped, { older: 0, notRun: 0, unreadable: 1 });

    const imported = await postRaw(app, token, "import", "export_1.zip", upload);
    assert.equal(imported.json().saved, 3);
    const stored = await listActivityHistoryForAthlete("athlete-archive");
    assert.deepEqual(stored.map((ref) => ref.source).sort(), ["fit_upload", "gpx_upload", "tcx_upload"]);

    // The same FIT shared plain later is the same run: its fingerprint is the unpacked file's.
    const again = await post(app, token, "/activity-history/file", "hill.fit", hill);
    assert.equal(again.statusCode, 200);
  });
});

test("a single gzipped activity imports; a corrupt gzip in a .zip is unreadable", async () => {
  await withApp(async (app, token) => {
    const single = await post(app, token, "/activity-history/file", "run.fit.gz", new Uint8Array(gzipSync(fixture("activity-short-road.fit"))));
    assert.equal(single.statusCode, 201);
    assert.equal(single.json().source, "fit_upload");
    const broken = new Uint8Array([0x1f, 0x8b, 0x08, 0, 1, 2, 3, 4, 5]);
    const res = await post(app, token, "/activity-history/preview", "export.zip", zip([
      { name: "a/run.gpx", bytes: fixture("activity-short-road.gpx") },
      { name: "a/bad.fit.gz", bytes: broken }
    ]));
    assert.deepEqual(res.json().unreadable.map((row: { fileName: string }) => row.fileName), ["bad.fit.gz"]);
  });
});
