import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { buildApp } from "../app.js";
import { countActivityHistoryRows, resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { readZipEntries, ZipArchiveError } from "../lib/zipArchive.js";

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
