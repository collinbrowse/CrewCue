import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoomLatestPingResponse, RaceRoomProjection } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";

/**
 * Courses that pass the same ground twice: a loop that finishes where it starts, and an
 * out-and-back. The runner's progress has to follow the leg they are on, not whichever part of
 * the route line happens to be nearest to the GPS fix.
 */

function claims(sub: string) {
  return { sub, teamIds: ["team-1"], roomRoles: {} };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

type Point = { latitude: number; longitude: number };

async function createRoomWithCourse(
  app: ReturnType<typeof buildApp>,
  athleteToken: string,
  course: { checkpoints: Array<Point & { id: string }>; route: Point[]; raceStartAt: string }
): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "runner", name: "Loop Course Room", creatorRole: "athlete" },
    headers: auth(athleteToken)
  });
  assert.equal(created.statusCode, 201);
  const roomId = (created.json() as { id: string }).id;

  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: auth(athleteToken)
  });
  assert.equal(paid.statusCode, 200);

  const saved = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: { checkpoints: course.checkpoints },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints(course.route),
      plannedPaceSecondsPerKm: 480,
      raceStartAt: course.raceStartAt
    },
    headers: auth(athleteToken)
  });
  assert.equal(saved.statusCode, 200, saved.body);
  return roomId;
}

async function ping(app: ReturnType<typeof buildApp>, roomId: string, token: string, at: Point, recordedAtMs: number) {
  const response = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { ...at, recordedAt: new Date(recordedAtMs).toISOString(), uploadIntervalSeconds: 60 },
    headers: auth(token)
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { projection: RaceRoomProjection }).projection;
}

async function batch(
  app: ReturnType<typeof buildApp>,
  roomId: string,
  token: string,
  points: Array<Point & { recordedAtMs: number }>
) {
  const response = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings/batch`,
    payload: {
      points: points.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: new Date(p.recordedAtMs).toISOString()
      })),
      uploadIntervalSeconds: 60
    },
    headers: auth(token)
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { acceptedCount: number; projection: RaceRoomProjection };
  assert.equal(body.acceptedCount, points.length, response.body);
  return body.projection;
}

async function latestProgress(app: ReturnType<typeof buildApp>, roomId: string, token: string): Promise<number> {
  const response = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/pings/latest`,
    headers: auth(token)
  });
  assert.equal(response.statusCode, 200);
  const progress = (response.json() as RaceRoomLatestPingResponse).ping?.progressMeters;
  assert.equal(typeof progress, "number");
  return progress as number;
}

function split(projection: RaceRoomProjection, checkpointId: string) {
  const row = projection.checkpointSplits.find((s) => s.checkpointId === checkpointId);
  assert.ok(row, `split ${checkpointId}`);
  return row;
}

// A square loop, about 1.1 km north, 0.8 km east, back south and back west to the start.
const LOOP_START: Point = { latitude: 42.0, longitude: -70.0 };
const LOOP_NW: Point = { latitude: 42.01, longitude: -70.0 };
const LOOP_NE: Point = { latitude: 42.01, longitude: -69.99 };
const LOOP_SE: Point = { latitude: 42.0, longitude: -69.99 };
const LOOP_ROUTE = [LOOP_START, LOOP_NW, LOOP_NE, LOOP_SE, LOOP_START];
const LOOP_CHECKPOINTS = [
  { id: "start", ...LOOP_START },
  { id: "aid-ne", ...LOOP_NE },
  { id: "finish", ...LOOP_START }
];

test("a runner at the start line of a loop course is at the start, not the finish", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const now = Date.now();
  const roomId = await createRoomWithCourse(app, athlete, {
    checkpoints: LOOP_CHECKPOINTS,
    route: LOOP_ROUTE,
    raceStartAt: new Date(now - 60_000).toISOString()
  });

  // In the start corral, about 6 m along the finishing straight (which arrives from the east).
  const projection = await ping(app, roomId, athlete, { latitude: 42.0, longitude: -69.99993 }, now - 30_000);

  assert.ok(
    projection.progressMeters < 100,
    `progress at the start line should be near 0 of ${Math.round(projection.courseLengthMeters)} m, got ${Math.round(projection.progressMeters)} m`
  );
  assert.equal(split(projection, "aid-ne").crossedAtRecordedAt, null, "the far aid station is not crossed yet");
  assert.equal(split(projection, "finish").crossedAtRecordedAt, null, "the finish is not crossed yet");
  assert.ok((await latestProgress(app, roomId, athlete)) < 100, "crew read the same start-line progress");

  await app.close();
});

test("a runner who goes all the way round a loop course finishes at the finish", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const now = Date.now();
  const startMs = now - 3_600_000;
  const roomId = await createRoomWithCourse(app, athlete, {
    checkpoints: LOOP_CHECKPOINTS,
    route: LOOP_ROUTE,
    raceStartAt: new Date(startMs).toISOString()
  });

  // One fix every four minutes, uploaded as the phone's backlog. The last one is on the
  // finishing straight, about 6 m short of the line: the same spot as the start-line fix above.
  const lap: Point[] = [
    { latitude: 42.0, longitude: -69.99993 },
    { latitude: 42.005, longitude: -70.0 },
    LOOP_NW,
    { latitude: 42.01, longitude: -69.995 },
    LOOP_NE,
    { latitude: 42.005, longitude: -69.99 },
    LOOP_SE,
    { latitude: 42.0, longitude: -69.995 },
    { latitude: 42.0, longitude: -69.99993 }
  ];
  const projection = await batch(
    app,
    roomId,
    athlete,
    lap.map((p, i) => ({ ...p, recordedAtMs: startMs + 60_000 + i * 240_000 }))
  );

  const length = projection.courseLengthMeters;
  assert.ok(
    projection.progressMeters > length - 100,
    `progress after the lap should be near ${Math.round(length)} m, got ${Math.round(projection.progressMeters)} m`
  );
  assert.equal(
    split(projection, "aid-ne").crossedAtRecordedAt,
    new Date(startMs + 60_000 + 4 * 240_000).toISOString(),
    "the far aid station is crossed when the runner gets there"
  );

  await app.close();
});

test("a runner heading out on an out-and-back course is on the way out, not the way back", async () => {
  const app = buildApp();
  await app.ready();
  const athlete = app.jwt.sign(claims("runner"));
  const now = Date.now();
  const startMs = now - 3_600_000;
  // About 3.3 km north, then back along the same trail. As in a recorded GPX, the return line
  // sits a few metres beside the outbound one.
  const start: Point = { latitude: 42.0, longitude: -70.0 };
  const turn: Point = { latitude: 42.03, longitude: -70.0 };
  const turnBack: Point = { latitude: 42.03, longitude: -69.9999 };
  const finish: Point = { latitude: 42.0, longitude: -69.9999 };
  const roomId = await createRoomWithCourse(app, athlete, {
    checkpoints: [
      { id: "start", ...start },
      { id: "turnaround", ...turn },
      { id: "finish", ...finish }
    ],
    route: [start, turn, turnBack, finish],
    raceStartAt: new Date(startMs).toISOString()
  });

  // Five fixes a minute apart, heading north for the first kilometre. GPS puts each one a few
  // metres east of the outbound line, which is nearer the return line.
  const fixes = [0.002, 0.004, 0.006, 0.008, 0.01].map((dLat, i) => ({
    latitude: 42.0 + dLat,
    longitude: -69.99992,
    recordedAtMs: startMs + 60_000 + i * 60_000
  }));
  const projection = await batch(app, roomId, athlete, fixes);

  assert.ok(
    projection.progressMeters > 900 && projection.progressMeters < 1300,
    `about 1.1 km into a ${Math.round(projection.courseLengthMeters)} m course, got ${Math.round(projection.progressMeters)} m`
  );
  assert.equal(split(projection, "turnaround").crossedAtRecordedAt, null, "the turnaround is not crossed yet");

  await app.close();
});
