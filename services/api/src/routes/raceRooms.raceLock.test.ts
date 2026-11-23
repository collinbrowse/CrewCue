/**
 * The race lock and race rename. A Race Pass pays for one race: once the race is used (the first
 * runner ping at or after the start, or 48 hours after the start), its route line and start are
 * locked so the paid room cannot be reused for another race. Renaming and aid-station edits stay
 * open. See lib/raceLock.ts. Runs in memory and on Postgres (CI).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { MapWorkspaceLayer, RaceMapWorkspace, RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetPacingEstimateStoreForTests } from "../lib/pacingEstimateStore.js";
import { RACE_LOCK_AFTER_START_MS, effectiveRaceLockedAt, isRaceLocked } from "../lib/raceLock.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

type App = ReturnType<typeof buildApp>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The 50k fixture's start line. */
const START = { latitude: 39.15, longitude: -120.25 };
const upRoute = (meters: number) => ({ latitude: START.latitude + meters / 111_195, longitude: START.longitude });

const iso = (ms: number) => new Date(ms).toISOString();
const wholeSecond = (ms: number) => Math.floor(ms / 1000) * 1000;

function auth(app: App, sub: string) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, teamIds: ["team-1"], roomRoles: {} })}` };
}

async function withApp(run: (app: App) => Promise<void>): Promise<void> {
  await resetPacingEstimateStoreForTests();
  const app = buildApp();
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

/** Another race's route: the 50k line moved about 1 km east. */
function otherRoute(): MapWorkspaceLayer {
  const layer = load50kCourseWithAids().routeOverlayLayer;
  assert.equal(layer.geometry.type, "LineString");
  const coordinates = (layer.geometry as { coordinates: number[][] }).coordinates.map(([lon, lat, ...rest]) => [
    lon! + 0.012,
    lat!,
    ...rest
  ]);
  return { ...layer, id: "other-race", geometry: { type: "LineString", coordinates } } as MapWorkspaceLayer;
}

async function createRace(app: App, runner: string, { paid }: { paid: boolean }): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: runner, name: "Lock 50k", creatorRole: "athlete" },
    headers: auth(app, runner)
  });
  assert.equal(created.statusCode, 201, created.body);
  const roomId = (created.json() as RaceRoom).id;
  if (paid) {
    const pay = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: "paid" },
      headers: auth(app, runner)
    });
    assert.equal(pay.statusCode, 200, pay.body);
  }
  return roomId;
}

function putCourse(
  app: App,
  roomId: string,
  user: string,
  raceStartAt: string,
  options: { routeOverlayLayer?: MapWorkspaceLayer; titles?: string; courseGpxXml?: string } = {}
) {
  const fixture = load50kCourseWithAids();
  const checkpoints = fixture.checkpoints.map((checkpoint, index) =>
    options.titles && index > 0 && index < fixture.checkpoints.length - 1
      ? { ...checkpoint, title: `${options.titles} ${index}` }
      : checkpoint
  );
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints },
      ...(options.routeOverlayLayer ? { routeOverlayLayer: options.routeOverlayLayer } : {}),
      ...(options.courseGpxXml ? { courseGpxXml: options.courseGpxXml } : {}),
      raceStartAt
    },
    headers: auth(app, user)
  });
}

async function raceOn50k(app: App, runner: string, raceStartAt: string, paid = true): Promise<string> {
  const roomId = await createRace(app, runner, { paid });
  const course = await putCourse(app, roomId, runner, raceStartAt, {
    routeOverlayLayer: load50kCourseWithAids().routeOverlayLayer
  });
  assert.equal(course.statusCode, 200, course.body);
  return roomId;
}

function ping(app: App, roomId: string, runner: string, recordedAtMs: number) {
  return app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { ...upRoute(200), recordedAt: iso(recordedAtMs), uploadIntervalSeconds: 30 },
    headers: auth(app, runner)
  });
}

function patchStart(app: App, roomId: string, user: string, raceStartAt: string) {
  return app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/race-start`,
    payload: { raceStartAt },
    headers: auth(app, user)
  });
}

function rename(app: App, roomId: string, user: string | undefined, name: unknown) {
  return app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}`,
    payload: { name },
    ...(user ? { headers: auth(app, user) } : {})
  });
}

async function readRoom(app: App, roomId: string, user: string): Promise<RaceRoom> {
  const response = await app.inject({ method: "GET", url: `/race-rooms/${roomId}`, headers: auth(app, user) });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as { room: RaceRoom }).room;
}

async function readWorkspace(app: App, roomId: string, user: string): Promise<RaceMapWorkspace> {
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/map-workspace`,
    headers: auth(app, user)
  });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as { mapWorkspace: RaceMapWorkspace }).mapWorkspace;
}

function putWorkspace(app: App, roomId: string, user: string, workspace: RaceMapWorkspace) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/map-workspace`,
    payload: {
      layers: workspace.layers,
      selectedLayerId: workspace.selectedLayerId,
      drivesProjectionLayerId: workspace.drivesProjectionLayerId,
      checkpoints: workspace.checkpoints
    },
    headers: auth(app, user)
  });
}

function assertLocked(response: { statusCode: number; body: string; json: () => unknown }) {
  assert.equal(response.statusCode, 409, response.body);
  const body = response.json() as { error: string; code: string };
  assert.equal(body.code, "race_locked");
  assert.match(body.error, /locked/);
}

test("isRaceLocked: paid rooms only; a stored lock, or 48 hours after the start", () => {
  const now = Date.parse("2030-06-10T12:00:00.000Z");
  const base = {
    id: "r",
    teamId: "t",
    athleteId: "a",
    name: "n",
    status: "active",
    createdAt: iso(now - 10 * DAY),
    memberships: [],
    entitlement: { status: "paid", lastUpdatedAt: iso(now) }
  } as unknown as RaceRoom;
  assert.equal(isRaceLocked(base, now), false, "no start, no lock");
  const started = { ...base, raceStartAt: iso(now - HOUR) };
  assert.equal(isRaceLocked(started, now), false, "started an hour ago with no race ping");
  const grace = { ...base, raceStartAt: iso(now - RACE_LOCK_AFTER_START_MS - 1) };
  assert.equal(effectiveRaceLockedAt(grace, now), iso(now - 1));
  const pinged = { ...started, raceLockedAt: iso(now - 30 * MINUTE) };
  assert.equal(effectiveRaceLockedAt(pinged, now), iso(now - 30 * MINUTE));
  const unpaid = { ...pinged, raceStartAt: iso(now - 3 * DAY), entitlement: { status: "unpaid" } } as RaceRoom;
  assert.equal(isRaceLocked(unpaid, now), false, "an unpaid room is never locked");
  const expired = { ...grace, entitlement: { status: "expired" } } as RaceRoom;
  assert.equal(isRaceLocked(expired, now), false);
});

test("a race ping locks a paid race: no new route, GPX or start; aid stations, rename and planned stops stay open", async () => {
  await withApp(async (app) => {
    const runner = "lock-runner";
    const now = wholeSecond(Date.now());
    const start = iso(now - HOUR);
    const roomId = await raceOn50k(app, runner, start);
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, undefined, "not locked before a race ping");

    // Before any race ping the runner can still fix the course and the start.
    const fixedCourse = await putCourse(app, roomId, runner, start, { routeOverlayLayer: otherRoute() });
    assert.equal(fixedCourse.statusCode, 200, fixedCourse.body);
    const backCourse = await putCourse(app, roomId, runner, start, {
      routeOverlayLayer: load50kCourseWithAids().routeOverlayLayer
    });
    assert.equal(backCourse.statusCode, 200, backCourse.body);

    const pinged = await ping(app, roomId, runner, now);
    assert.equal(pinged.statusCode, 201, pinged.body);
    const locked = await readRoom(app, roomId, runner);
    assert.equal(locked.raceLockedAt, iso(now));

    // A later ping does not move the lock.
    const later = await ping(app, roomId, runner, now + 30_000);
    assert.equal(later.statusCode, 201, later.body);
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, iso(now));

    // Refused: a new route line, a new start (on its route or in the course save), a new GPX.
    assertLocked(await putCourse(app, roomId, runner, start, { routeOverlayLayer: otherRoute() }));
    assertLocked(await patchStart(app, roomId, runner, iso(now + 7 * DAY)));
    assertLocked(await putCourse(app, roomId, runner, iso(now + 7 * DAY)));
    assertLocked(
      await putCourse(app, roomId, runner, start, { courseGpxXml: "<gpx><trk><name>Another race</name></trk></gpx>" })
    );
    const workspace = await readWorkspace(app, roomId, runner);
    const drivingId = workspace.drivesProjectionLayerId;
    assert.ok(drivingId, "the course save set the driving layer");
    const moved = {
      ...workspace,
      layers: workspace.layers.map((layer) =>
        layer.id === drivingId ? { ...otherRoute(), id: drivingId } : layer
      )
    };
    assertLocked(await putWorkspace(app, roomId, runner, moved));

    const unchanged = await readRoom(app, roomId, runner);
    assert.equal(unchanged.raceStartAt, start);
    assert.equal(unchanged.courseDistanceMeters, locked.courseDistanceMeters);

    // Allowed: the same route with new aid-station names, the same route resent, the same start.
    const aidEdit = await putCourse(app, roomId, runner, start, { titles: "Aid" });
    assert.equal(aidEdit.statusCode, 200, aidEdit.body);
    const sameRoute = await putCourse(app, roomId, runner, start, {
      routeOverlayLayer: load50kCourseWithAids().routeOverlayLayer,
      titles: "Aid station"
    });
    assert.equal(sameRoute.statusCode, 200, sameRoute.body);
    assert.equal((sameRoute.json() as RaceRoom).course?.checkpoints[1]?.title, "Aid station 1");
    const sameStart = await patchStart(app, roomId, runner, start);
    assert.equal(sameStart.statusCode, 200, sameStart.body);
    // A delayed gun: the start may still move within 12 hours of the locking ping, and back.
    assertLocked(await patchStart(app, roomId, runner, iso(now + 13 * HOUR)));
    const delayed = await patchStart(app, roomId, runner, iso(now + 30 * MINUTE));
    assert.equal(delayed.statusCode, 200, delayed.body);
    const delayedCourse = await putCourse(app, roomId, runner, start);
    assert.equal(delayedCourse.statusCode, 200, delayedCourse.body);
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, iso(now), "the lock stays");
    const workspaceNow = await readWorkspace(app, roomId, runner);
    const sameWorkspace = await putWorkspace(app, roomId, runner, workspaceNow);
    assert.equal(sameWorkspace.statusCode, 200, sameWorkspace.body);

    const renamed = await rename(app, roomId, runner, "  Western States 2030  ");
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((renamed.json() as RaceRoom).name, "Western States 2030");
    assert.equal((renamed.json() as RaceRoom).raceLockedAt, iso(now));

    // A refund puts the room back to unpaid: never locked, and the response carries no lock.
    const refund = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: "unpaid" },
      headers: auth(app, runner)
    });
    assert.equal(refund.statusCode, 200, refund.body);
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, undefined);
  });
});

test("a pre-start ping does not lock the race", async () => {
  await withApp(async (app) => {
    const runner = "lock-prestart-runner";
    const now = wholeSecond(Date.now());
    const start = iso(now + DAY);
    const roomId = await raceOn50k(app, runner, start);
    const pinged = await ping(app, roomId, runner, now);
    assert.equal(pinged.statusCode, 201, pinged.body);
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, undefined);
    const moved = await patchStart(app, roomId, runner, iso(now + 2 * DAY));
    assert.equal(moved.statusCode, 200, moved.body);
    const newRoute = await putCourse(app, roomId, runner, iso(now + 2 * DAY), { routeOverlayLayer: otherRoute() });
    assert.equal(newRoute.statusCode, 200, newRoute.body);
  });
});

test("a backlog upload locks the race at its first race sample", async () => {
  await withApp(async (app) => {
    const runner = "lock-batch-runner";
    const now = wholeSecond(Date.now());
    const startMs = now - 10 * MINUTE;
    const roomId = await raceOn50k(app, runner, iso(startMs));
    const batch = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/pings/batch`,
      payload: {
        points: [
          { ...upRoute(0), recordedAt: iso(startMs - 2 * MINUTE) },
          { ...upRoute(100), recordedAt: iso(startMs + MINUTE) },
          { ...upRoute(300), recordedAt: iso(startMs + 3 * MINUTE) }
        ]
      },
      headers: auth(app, runner)
    });
    assert.equal(batch.statusCode, 200, batch.body);
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, iso(startMs + MINUTE));
    assertLocked(await patchStart(app, roomId, runner, iso(now + DAY)));
  });
});

test("48 hours after the start a paid race is locked without any ping; an unpaid one never is", async () => {
  await withApp(async (app) => {
    const runner = "lock-grace-runner";
    const startMs = wholeSecond(Date.now()) - 49 * HOUR;
    const roomId = await raceOn50k(app, runner, iso(startMs));
    assert.equal((await readRoom(app, roomId, runner)).raceLockedAt, iso(startMs + RACE_LOCK_AFTER_START_MS));
    assertLocked(await patchStart(app, roomId, runner, iso(Date.now() + DAY)));
    assertLocked(await putCourse(app, roomId, runner, iso(startMs), { routeOverlayLayer: otherRoute() }));

    const unpaidRoomId = await raceOn50k(app, "lock-unpaid-runner", iso(startMs), false);
    assert.equal((await readRoom(app, unpaidRoomId, "lock-unpaid-runner")).raceLockedAt, undefined);
    const moved = await patchStart(app, unpaidRoomId, "lock-unpaid-runner", iso(Date.now() + DAY));
    assert.equal(moved.statusCode, 200, moved.body);
  });
});

test("PATCH /race-rooms/:roomId renames the race for race-setup editors", async () => {
  await withApp(async (app) => {
    const runner = "rename-runner";
    const roomId = await createRace(app, runner, { paid: true });
    const joinCode = (await readRoom(app, roomId, runner)).joinCode;
    assert.ok(joinCode);
    const join = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: joinCode },
      headers: auth(app, "rename-crew")
    });
    assert.equal(join.statusCode, 200, join.body);

    assert.equal((await rename(app, roomId, undefined, "New name")).statusCode, 401);
    assert.equal((await rename(app, "no-such-room", runner, "New name")).statusCode, 404);
    assert.equal((await rename(app, roomId, "rename-stranger", "New name")).statusCode, 403);
    const crew = await rename(app, roomId, "rename-crew", "New name");
    assert.equal(crew.statusCode, 403, "a crew member cannot edit race setup");
    assert.equal((await rename(app, roomId, runner, "   ")).statusCode, 400);
    assert.equal((await rename(app, roomId, runner, "x".repeat(81))).statusCode, 400);
    assert.equal((await rename(app, roomId, runner, 42)).statusCode, 400);

    const renamed = await rename(app, roomId, runner, " Canyons 100K ");
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((renamed.json() as RaceRoom).name, "Canyons 100K");
    assert.equal((await readRoom(app, roomId, "rename-crew")).name, "Canyons 100K", "crew read the new name");
    const mine = await app.inject({ method: "GET", url: "/race-rooms/mine", headers: auth(app, "rename-crew") });
    assert.equal(mine.statusCode, 200, mine.body);
    assert.ok((mine.json() as { rooms: RaceRoom[] }).rooms.some((room) => room.name === "Canyons 100K"));
    assert.equal((await rename(app, roomId, runner, "x".repeat(80))).statusCode, 200);

    // The runner renames an unpaid race too; crew on an unpaid race are refused (402).
    const unpaidId = await createRace(app, "rename-unpaid-runner", { paid: false });
    const unpaid = await rename(app, unpaidId, "rename-unpaid-runner", "Unpaid rename");
    assert.equal(unpaid.statusCode, 200, unpaid.body);
  });
});
