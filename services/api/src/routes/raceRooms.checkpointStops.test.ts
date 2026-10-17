/**
 * #250 — PATCH /race-rooms/:roomId/checkpoint-stops (planned aid stop minutes from Pace edit).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CrewScheduleSheet, RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { clearTaskBoardLocalState, MAX_PLANNED_STOP_SECONDS } from "./raceRooms.js";

const RACE_START_AT = "2026-08-15T13:00:00.000Z";

type TestApp = ReturnType<typeof buildApp>;

function claims(sub: string) {
  return { sub, teamIds: ["team-1"], roomRoles: {} };
}

async function roomWithCourse(app: TestApp, ownerToken: string, name: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "athlete-1", name, creatorRole: "athlete" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(created.statusCode, 201);
  const roomId = (created.json() as { id: string }).id;
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(paid.statusCode, 200);
  const fixture = load50kCourseWithAids();
  const put = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints: fixture.checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(put.statusCode, 200);
  return roomId;
}

function patchStops(app: TestApp, roomId: string, token: string | null, payload: unknown) {
  return app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoint-stops`,
    payload: payload as Record<string, unknown>,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
  });
}

async function getRoom(app: TestApp, roomId: string, token: string): Promise<RaceRoom> {
  const response = await app.inject({ method: "GET", url: `/race-rooms/${roomId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  return (response.json() as { room: RaceRoom }).room;
}

async function getSchedule(app: TestApp, roomId: string, token: string): Promise<CrewScheduleSheet> {
  const response = await app.inject({ method: "GET", url: `/race-rooms/${roomId}/schedule`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  return response.json() as CrewScheduleSheet;
}

function plannedStop(room: RaceRoom, id: string): number | undefined {
  return room.course?.checkpoints.find((checkpoint) => checkpoint.id === id)?.plannedStopSeconds;
}

test("EC1: planned stops persist and shift every later scheduled arrival by the change", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(claims("athlete-stops-ec1"));
  const roomId = await roomWithCourse(app, token, "Stops EC1");
  const before = await getSchedule(app, roomId, token);
  const beforeRoom = await getRoom(app, roomId, token);
  const aid1Before = plannedStop(beforeRoom, "aid-1") ?? 0;
  const aid2Before = plannedStop(beforeRoom, "aid-2") ?? 0;

  const response = await patchStops(app, roomId, token, {
    stops: [
      { checkpointId: "aid-1", plannedStopSeconds: 600 },
      { checkpointId: "aid-2", plannedStopSeconds: 0 }
    ]
  });
  assert.equal(response.statusCode, 200);
  assert.equal(plannedStop(response.json() as RaceRoom, "aid-1"), 600);

  const room = await getRoom(app, roomId, token);
  assert.equal(plannedStop(room, "aid-1"), 600);
  assert.equal(plannedStop(room, "aid-2"), 0);
  assert.equal(plannedStop(room, "aid-3"), plannedStop(beforeRoom, "aid-3"), "untouched checkpoints keep their stop");

  const after = await getSchedule(app, roomId, token);
  const elapsed = (sheet: CrewScheduleSheet, id: string) => sheet.stops.find((stop) => stop.checkpointId === id)!.elapsedSeconds;
  const aid1Delta = 600 - aid1Before;
  const aid2Delta = 0 - aid2Before;
  // A stop only delays checkpoints AFTER it; arrival at the stop itself is unchanged.
  assert.equal(elapsed(after, "aid-1"), elapsed(before, "aid-1"));
  assert.equal(elapsed(after, "aid-2"), elapsed(before, "aid-2") + aid1Delta);
  assert.equal(elapsed(after, "aid-3"), elapsed(before, "aid-3") + aid1Delta + aid2Delta);
  assert.equal(after.stops.find((stop) => stop.checkpointId === "aid-1")!.plannedStoppageSeconds, 600);
  await app.close();
});

test("EC2: editing stops keeps the crew task board (no course-dependent reset)", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(claims("athlete-stops-ec2"));
  const roomId = await roomWithCourse(app, token, "Stops EC2");
  const board = await app.inject({ method: "GET", url: `/race-rooms/${roomId}/tasks`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(board.statusCode, 200);
  const taskId = (board.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;
  const started = await app.inject({ method: "POST", url: `/race-rooms/${roomId}/tasks/${taskId}/start`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(started.statusCode, 200);

  const response = await patchStops(app, roomId, token, { stops: [{ checkpointId: "aid-2", plannedStopSeconds: 900 }] });
  assert.equal(response.statusCode, 200);

  clearTaskBoardLocalState(roomId);
  const afterBoard = await app.inject({ method: "GET", url: `/race-rooms/${roomId}/tasks`, headers: { authorization: `Bearer ${token}` } });
  const task = (afterBoard.json() as { tasks: Array<{ id: string; status: string }> }).tasks.find((row) => row.id === taskId);
  assert.equal(task?.status, "in_progress");
  await app.close();
});

test("EC3: invalid payloads are rejected with 400 and change nothing", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(claims("athlete-stops-ec3"));
  const roomId = await roomWithCourse(app, token, "Stops EC3");
  const before = await getRoom(app, roomId, token);
  const invalid: unknown[] = [
    {},
    { stops: [] },
    { stops: [{ checkpointId: "aid-1", plannedStopSeconds: -60 }] },
    { stops: [{ checkpointId: "aid-1", plannedStopSeconds: 90.5 }] },
    { stops: [{ checkpointId: "aid-1", plannedStopSeconds: MAX_PLANNED_STOP_SECONDS + 1 }] },
    { stops: [{ checkpointId: "aid-1", plannedStopSeconds: "600" }] },
    { stops: [{ checkpointId: "aid-1", plannedStopSeconds: 60 }, { checkpointId: "aid-1", plannedStopSeconds: 120 }] }
  ];
  for (const payload of invalid) {
    const response = await patchStops(app, roomId, token, payload);
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  const boundary = await patchStops(app, roomId, token, { stops: [{ checkpointId: "aid-1", plannedStopSeconds: MAX_PLANNED_STOP_SECONDS }] });
  assert.equal(boundary.statusCode, 200);
  const after = await getRoom(app, roomId, token);
  assert.equal(plannedStop(after, "aid-2"), plannedStop(before, "aid-2"));
  await app.close();
});

test("EC4: an unknown checkpoint fails the whole request with 404 (all or nothing)", async () => {
  const app = buildApp();
  await app.ready();
  const token = app.jwt.sign(claims("athlete-stops-ec4"));
  const roomId = await roomWithCourse(app, token, "Stops EC4");
  const before = await getRoom(app, roomId, token);
  const response = await patchStops(app, roomId, token, {
    stops: [
      { checkpointId: "aid-1", plannedStopSeconds: 1200 },
      { checkpointId: "nope", plannedStopSeconds: 60 }
    ]
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual((response.json() as { checkpointIds: string[] }).checkpointIds, ["nope"]);
  assert.equal(plannedStop(await getRoom(app, roomId, token), "aid-1"), plannedStop(before, "aid-1"));
  await app.close();
});

test("EC5: only course editors may set planned stops", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(claims("athlete-stops-ec5"));
  const crewToken = app.jwt.sign(claims("crew-stops-ec5"));
  const strangerToken = app.jwt.sign(claims("stranger-stops-ec5"));
  const roomId = await roomWithCourse(app, ownerToken, "Stops EC5");
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(invite.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (invite.json() as { token: string }).token },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(accept.statusCode, 200);

  const body = { stops: [{ checkpointId: "aid-1", plannedStopSeconds: 300 }] };
  assert.equal((await patchStops(app, roomId, null, body)).statusCode, 401);
  assert.equal((await patchStops(app, roomId, crewToken, body)).statusCode, 403);
  assert.equal((await patchStops(app, roomId, strangerToken, body)).statusCode, 403);
  await app.close();
});
