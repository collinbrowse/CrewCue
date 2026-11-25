import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { buildApp } from "../app.js";
import { countActivityHistoryRows, resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
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
