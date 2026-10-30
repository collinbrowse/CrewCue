import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoomLatestPingResponse, RaceRoomProjection } from "@crewcue/contracts";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { STALENESS_MAX_SECONDS } from "../lib/projectionTimeliness.js";

function claims(sub: string) {
  return { sub, teamIds: ["team-1"], roomRoles: {} };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createRoom(
  app: ReturnType<typeof buildApp>,
  athleteToken: string,
  options: { paid?: boolean } = {}
): Promise<{ id: string; joinCode: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "runner", name: "Latest Ping Room", creatorRole: "athlete" },
    headers: auth(athleteToken)
  });
  assert.equal(created.statusCode, 201);
  const room = created.json() as { id: string; joinCode: string };
  const roomId = room.id;
  if (options.paid === false) {
    return room;
  }

  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: auth(athleteToken)
  });
  assert.equal(paid.statusCode, 200);

  const course = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 42.0, longitude: -70.0 },
          { id: "cp1", latitude: 42.01, longitude: -70.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 42.0, longitude: -70.0 },
        { latitude: 42.01, longitude: -70.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: new Date(Date.now() - 3_600_000).toISOString()
    },
    headers: auth(athleteToken)
  });
  assert.equal(course.statusCode, 200);
  return room;
}

async function joinAsCrew(app: ReturnType<typeof buildApp>, joinCode: string, crewToken: string): Promise<void> {
  const joined = await app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: { roomCode: joinCode },
    headers: auth(crewToken)
  });
  assert.equal(joined.statusCode, 200);
  assert.equal((joined.json() as { assignedRole: string }).assignedRole, "crew_member");
}

async function ping(
  app: ReturnType<typeof buildApp>,
  roomId: string,
  token: string,
  payload: Record<string, unknown>
) {
  return app.inject({ method: "POST", url: `/race-rooms/${roomId}/pings`, payload, headers: auth(token) });
}

async function latest(app: ReturnType<typeof buildApp>, roomId: string, token: string) {
  return app.inject({ method: "GET", url: `/race-rooms/${roomId}/pings/latest`, headers: auth(token) });
}

test("latest ping is absent before the athlete's first accepted ping", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const { id: roomId } = await createRoom(app, athlete);

  const response = await latest(app, roomId, athlete);
  assert.equal(response.statusCode, 200);
  const body = response.json() as RaceRoomLatestPingResponse;
  assert.equal(body.roomId, roomId);
  assert.equal("ping" in body, false);
  assert.equal(body.stalenessThresholdSeconds, STALENESS_MAX_SECONDS);
  assert.ok(Number.isFinite(Date.parse(body.evaluatedAt)));

  await app.close();
});

test("every crew member reads the athlete's ping, recordedAt, and projection progress", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const crewA = app.jwt.sign(claims("crew-a"));
  const crewB = app.jwt.sign(claims("crew-b"));
  const { id: roomId, joinCode } = await createRoom(app, athlete);
  await joinAsCrew(app, joinCode, crewA);
  await joinAsCrew(app, joinCode, crewB);

  const recordedAt = new Date(Date.now() - 45_000).toISOString();
  const accepted = await ping(app, roomId, athlete, {
    latitude: 42.005,
    longitude: -70.0,
    recordedAt,
    uploadIntervalSeconds: 60
  });
  assert.equal(accepted.statusCode, 201);
  const pingId = (accepted.json() as { pingId: string }).pingId;

  const projection = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: auth(crewA)
  });
  assert.equal(projection.statusCode, 200);
  const projected = projection.json() as RaceRoomProjection;
  assert.equal(projected.asOfPingId, pingId);
  assert.ok(projected.progressMeters > 0);

  const reads = await Promise.all([latest(app, roomId, crewA), latest(app, roomId, crewB), latest(app, roomId, athlete)]);
  for (const read of reads) {
    assert.equal(read.statusCode, 200);
    const body = read.json() as RaceRoomLatestPingResponse;
    assert.deepEqual(body.ping && { ...body.ping, receivedAt: "-" }, {
      pingId,
      latitude: 42.005,
      longitude: -70.0,
      recordedAt,
      receivedAt: "-",
      progressMeters: projected.progressMeters
    });
    assert.ok(Date.parse(body.ping!.receivedAt) >= Date.parse(recordedAt));
    assert.equal(body.stalenessThresholdSeconds, 180);
  }

  await app.close();
});

test("a rejected ping does not replace the latest accepted one", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const { id: roomId } = await createRoom(app, athlete);

  const first = await ping(app, roomId, athlete, {
    latitude: 42.001,
    longitude: -70.0,
    recordedAt: new Date(Date.now() - 30_000).toISOString()
  });
  assert.equal(first.statusCode, 201);
  const firstId = (first.json() as { pingId: string }).pingId;

  const jump = await ping(app, roomId, athlete, {
    latitude: 43.0,
    longitude: -70.0,
    recordedAt: new Date(Date.now() - 20_000).toISOString()
  });
  assert.equal(jump.statusCode, 422);

  const body = (await latest(app, roomId, athlete)).json() as RaceRoomLatestPingResponse;
  assert.equal(body.ping?.pingId, firstId);
  assert.equal(body.ping?.latitude, 42.001);

  await app.close();
});

test("latest ping applies the same auth, membership, and entitlement gates as ping history", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const stranger = app.jwt.sign(claims("stranger"));
  const { id: roomId } = await createRoom(app, athlete);

  const anonymous = await app.inject({ method: "GET", url: `/race-rooms/${roomId}/pings/latest` });
  assert.equal(anonymous.statusCode, 401);

  assert.equal((await latest(app, roomId, stranger)).statusCode, 403);
  assert.equal((await latest(app, "missing-room", athlete)).statusCode, 404);

  const { id: unpaidRoom } = await createRoom(app, athlete, { paid: false });
  const unpaid = await latest(app, unpaidRoom, athlete);
  const history = await app.inject({
    method: "GET",
    url: `/race-rooms/${unpaidRoom}/pings/history`,
    headers: auth(athlete)
  });
  assert.equal(unpaid.statusCode, history.statusCode);
  assert.notEqual(unpaid.statusCode, 200);

  await app.close();
});

test(
  "crew still read the athlete's latest ping after the API restarts",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 60_000 },
  async () => {
    const app = buildApp();
    await app.ready();
    const athlete = app.jwt.sign(claims("runner"));
    const crew = app.jwt.sign(claims("crew-a"));
    const { id: roomId, joinCode } = await createRoom(app, athlete);
    await joinAsCrew(app, joinCode, crew);

    const recordedAt = new Date(Date.now() - 45_000).toISOString();
    const accepted = await ping(app, roomId, athlete, {
      latitude: 42.005,
      longitude: -70.0,
      recordedAt,
      uploadIntervalSeconds: 60
    });
    assert.equal(accepted.statusCode, 201);
    const pingId = (accepted.json() as { pingId: string }).pingId;
    const before = (await latest(app, roomId, crew)).json() as RaceRoomLatestPingResponse;
    assert.ok((before.ping?.progressMeters ?? 0) > 0);
    await app.close();

    // A fresh process has none of this room in memory; it must come back from Postgres.
    const appModule = fileURLToPath(new URL("../app.js", import.meta.url));
    const script = `
      const { buildApp } = await import(process.argv[1]);
      const app = buildApp();
      await app.ready();
      const res = await app.inject({
        method: "GET",
        url: "/race-rooms/" + process.argv[2] + "/pings/latest",
        headers: { authorization: "Bearer " + process.argv[3] }
      });
      process.stdout.write("\\nRESULT:" + JSON.stringify({ status: res.statusCode, body: res.json() }) + "\\n");
      await app.close();
      process.exit(0);
    `;
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, new URL(`file://${appModule}`).href, roomId, crew],
      { encoding: "utf8", env: process.env, timeout: 45_000 }
    );
    const result = JSON.parse(out.split("\n").find((line) => line.startsWith("RESULT:"))!.slice("RESULT:".length)) as {
      status: number;
      body: RaceRoomLatestPingResponse;
    };
    assert.equal(result.status, 200);
    assert.equal(result.body.ping?.pingId, pingId);
    assert.equal(result.body.ping?.recordedAt, recordedAt);
    assert.equal(result.body.ping?.progressMeters, before.ping?.progressMeters);
  }
);
