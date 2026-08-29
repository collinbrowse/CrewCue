import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import {
  countActivityHistoryRows,
  resetActivityHistoryStoreForTests
} from "../lib/activityHistoryStore.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "activity-long-trail.gpx"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const pacingDir = findPacingFixturesDir();

function readPacingGpx(fileName: string): string {
  return readFileSync(resolve(pacingDir, fileName), "utf8");
}

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Minimal valid track without elevation (EC8 optional metrics omitted). */
const GPX_NO_ELEVATION = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="crewcue-test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>No elevation</name>
    <trkseg>
      <trkpt lat="37.780000" lon="-122.420000"><time>2026-05-10T15:30:00Z</time></trkpt>
      <trkpt lat="37.782000" lon="-122.420000"><time>2026-05-10T15:35:00Z</time></trkpt>
      <trkpt lat="37.784000" lon="-122.420000"><time>2026-05-10T15:40:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

async function withApp(
  run: (ctx: {
    app: ReturnType<typeof buildApp>;
    tokenFor: (sub: string) => string;
  }) => Promise<void>
): Promise<void> {
  await resetActivityHistoryStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    await run({
      app,
      tokenFor: (sub) => app.jwt.sign(buildClaims(sub))
    });
  } finally {
    await app.close();
    await resetActivityHistoryStoreForTests();
  }
}

test("EC1: empty GPX is rejected and stores no history row", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const response = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gpxXml: readPacingGpx("empty.gpx"),
        externalId: "empty-1"
      }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { code?: string; error?: string };
    assert.equal(body.code, "gpx_empty");
    assert.match(String(body.error), /track points|empty/i);
    assert.equal(await countActivityHistoryRows(), 0);

    const list = await app.inject({
      method: "GET",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(list.statusCode, 200);
    assert.deepEqual((list.json() as { items: unknown[] }).items, []);
  });
});

test("EC2: corrupt GPX is rejected and stores no history row", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const response = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gpxXml: readPacingGpx("corrupt.gpx"),
        externalId: "corrupt-1"
      }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { code?: string };
    assert.ok(body.code === "gpx_corrupt" || body.code === "gpx_parse_failed" || body.code === "gpx_empty");
    assert.equal(await countActivityHistoryRows(), 0);
  });
});

test("EC3: unauthorized / wrong athlete cannot write history", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const noAuth = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      payload: {
        gpxXml: readPacingGpx("activity-short-road.gpx"),
        externalId: "unauth-1"
      }
    });
    assert.equal(noAuth.statusCode, 401);
    assert.equal(await countActivityHistoryRows(), 0);

    const athleteToken = tokenFor("athlete-1");
    const wrongAthlete = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${athleteToken}` },
      payload: {
        gpxXml: readPacingGpx("activity-short-road.gpx"),
        externalId: "wrong-athlete-1",
        athleteUserId: "athlete-other"
      }
    });
    assert.equal(wrongAthlete.statusCode, 403);
    assert.equal(await countActivityHistoryRows(), 0);
  });
});

test("EC4/EC5: idempotent replay of same source+externalId does not duplicate", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const payload = {
      gpxXml: readPacingGpx("activity-short-road.gpx"),
      externalId: "road-idem-1"
    };

    const first = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    assert.equal(first.statusCode, 201);
    const firstRef = parseActivityHistoryRef(first.json());

    const replay = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload
    });
    assert.equal(replay.statusCode, 200);
    const replayRef = parseActivityHistoryRef(replay.json());
    assert.equal(replayRef.id, firstRef.id);
    assert.equal(replayRef.externalId, firstRef.externalId);
    assert.equal(replayRef.source, "gpx_upload");
    assert.equal(await countActivityHistoryRows(), 1);

    const list = await app.inject({
      method: "GET",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal((list.json() as { items: ActivityHistoryRef[] }).items.length, 1);
  });
});

test("EC6: recordedAt/ingestedAt are ISO-Z; metrics use meters and seconds", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const response = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gpxXml: readPacingGpx("activity-long-trail.gpx"),
        externalId: "units-1"
      }
    });
    assert.equal(response.statusCode, 201);
    const ref = parseActivityHistoryRef(response.json());
    assert.match(ref.recordedAt, ISO_Z);
    assert.match(ref.ingestedAt, ISO_Z);
    assert.equal(ref.recordedAt, "2026-06-01T14:00:00.000Z");
    assert.ok(typeof ref.distanceMeters === "number" && ref.distanceMeters > 40_000);
    assert.ok(typeof ref.elapsedSeconds === "number" && ref.elapsedSeconds > 0);
    assert.ok(typeof ref.elevationGainMeters === "number" && ref.elevationGainMeters > 0);
  });
});

test("EC7: long trail and short road ingest independently with differing metrics", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");

    const longRes = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gpxXml: readPacingGpx("activity-long-trail.gpx"),
        externalId: "long-trail"
      }
    });
    const shortRes = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gpxXml: readPacingGpx("activity-short-road.gpx"),
        externalId: "short-road"
      }
    });
    assert.equal(longRes.statusCode, 201);
    assert.equal(shortRes.statusCode, 201);

    const longRef = parseActivityHistoryRef(longRes.json());
    const shortRef = parseActivityHistoryRef(shortRes.json());
    assert.notEqual(longRef.id, shortRef.id);
    assert.ok((longRef.distanceMeters ?? 0) > (shortRef.distanceMeters ?? 0));
    assert.ok((longRef.elevationGainMeters ?? 0) > (shortRef.elevationGainMeters ?? 0) + 1000);

    const list = await app.inject({
      method: "GET",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal((list.json() as { items: unknown[] }).items.length, 2);

    const getOne = await app.inject({
      method: "GET",
      url: `/activity-history/${longRef.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(getOne.statusCode, 200);
    assert.equal(parseActivityHistoryRef(getOne.json()).id, longRef.id);
  });
});

test("EC8: missing optional elevation still stores a history ref", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const response = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        gpxXml: GPX_NO_ELEVATION,
        externalId: "no-ele-1"
      }
    });
    assert.equal(response.statusCode, 201);
    const ref = parseActivityHistoryRef(response.json());
    assert.ok(ref.distanceMeters !== undefined && ref.distanceMeters > 0);
    assert.ok(ref.elapsedSeconds !== undefined && ref.elapsedSeconds > 0);
    assert.equal(ref.elevationGainMeters, undefined);
    assert.equal(await countActivityHistoryRows(), 1);
  });
});

test("list/get are scoped to the authenticated athlete", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const a = tokenFor("athlete-a");
    const b = tokenFor("athlete-b");

    const created = await app.inject({
      method: "POST",
      url: "/activity-history/gpx",
      headers: { authorization: `Bearer ${a}` },
      payload: {
        gpxXml: readPacingGpx("activity-short-road.gpx"),
        externalId: "scope-a"
      }
    });
    const ref = parseActivityHistoryRef(created.json());

    const listB = await app.inject({
      method: "GET",
      url: "/activity-history",
      headers: { authorization: `Bearer ${b}` }
    });
    assert.deepEqual((listB.json() as { items: unknown[] }).items, []);

    const getB = await app.inject({
      method: "GET",
      url: `/activity-history/${ref.id}`,
      headers: { authorization: `Bearer ${b}` }
    });
    assert.equal(getB.statusCode, 404);
  });
});

test("POST /activity-history metrics-only ingest is idempotent and athlete-scoped", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-metrics");
    const response = await app.inject({
      method: "POST",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        externalId: "metrics:short-road",
        recordedAt: "2026-05-10T15:30:00.000Z",
        distanceMeters: 10000,
        elapsedSeconds: 3600,
        elevationGainMeters: 120
      }
    });
    assert.equal(response.statusCode, 201);
    const ref = parseActivityHistoryRef(response.json());
    assert.equal(ref.source, "gpx_upload");
    assert.equal(ref.externalId, "metrics:short-road");
    assert.equal(ref.distanceMeters, 10000);
    assert.equal(ref.elapsedSeconds, 3600);

    const changedReplay = await app.inject({
      method: "POST",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        externalId: "metrics:short-road",
        recordedAt: "2026-05-10T16:00:00.000Z",
        distanceMeters: 99999,
        elapsedSeconds: 120,
        elevationGainMeters: 1
      }
    });
    assert.equal(changedReplay.statusCode, 200);
    assert.deepEqual(parseActivityHistoryRef(changedReplay.json()), ref);
    assert.equal(await countActivityHistoryRows(), 1);

    const otherAthlete = await app.inject({
      method: "POST",
      url: "/activity-history",
      headers: { authorization: `Bearer ${tokenFor("athlete-metrics-other")}` },
      payload: {
        externalId: "metrics:short-road",
        recordedAt: "2026-05-10T15:30:00.000Z",
        distanceMeters: 25000,
        elapsedSeconds: 7200
      }
    });
    assert.equal(otherAthlete.statusCode, 201);
    const otherRef = parseActivityHistoryRef(otherAthlete.json());
    assert.equal(otherRef.externalId, ref.externalId);
    assert.notEqual(otherRef.id, ref.id);
    assert.equal(otherRef.distanceMeters, 25000);
    assert.equal(await countActivityHistoryRows(), 2);
  });
});
