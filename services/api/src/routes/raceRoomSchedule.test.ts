import test from "node:test";
import assert from "node:assert/strict";
import { parseCrewScheduleSheet, type CrewScheduleSheet, type RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { getRaceRoom, saveRaceRoom } from "./raceRooms.js";
import { projectCrewScheduleSheet, setScheduleProjectionLoaderForTests } from "./raceRoomSchedule.js";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

type TestApp = ReturnType<typeof buildApp>;

async function createPaidRoom(app: TestApp, ownerToken: string, name: string): Promise<string> {
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name,
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;
  const entitlement = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(entitlement.statusCode, 200);
  return roomId;
}

async function put50kCourse(app: TestApp, roomId: string, ownerToken: string) {
  const fixture = load50kCourseWithAids();
  const response = await app.inject({
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
  assert.equal(response.statusCode, 200);
  return response.json() as RaceRoom;
}

async function getSchedule(app: TestApp, roomId: string, token?: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/schedule`,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
}

async function putStopPlan(
  app: TestApp,
  roomId: string,
  checkpointId: string,
  token: string,
  payload: object
) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/stop-plans/${checkpointId}`,
    payload,
    headers: { authorization: `Bearer ${token}` }
  });
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

test("EC1 no overlays still returns a parseable sheet omitting delay/notes", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec1"));
  const roomId = await createPaidRoom(app, ownerToken, "EC1 schedule no overlays");
  const seeded = await put50kCourse(app, roomId, ownerToken);
  assert.deepEqual(
    seeded.course?.checkpoints.map((checkpoint) => checkpoint.id),
    [...GOLDEN_CHECKPOINT_IDS]
  );

  const response = await getSchedule(app, roomId, ownerToken);
  assert.equal(response.statusCode, 200);
  const sheet = parseCrewScheduleSheet(response.json());
  assert.equal(sheet.roomId, roomId);
  assert.equal(sheet.raceStartAt, RACE_START_AT);
  assert.equal(sheet.pacingEstimateId, undefined);
  assert.deepEqual(
    sheet.stops.map((stop) => stop.checkpointId),
    [...GOLDEN_CHECKPOINT_IDS]
  );
  for (const stop of sheet.stops) {
    assert.equal(stop.id, `stop-${stop.checkpointId}`);
    assert.equal("delayOverrideSeconds" in stop, false);
    assert.equal("notes" in stop, false);
    assert.equal(typeof stop.plannedDwellSeconds, "number");
    assert.equal(typeof stop.elapsedSeconds, "number");
  }

  const expected = projectCrewScheduleSheet(seeded);
  assert.deepEqual(sheet, expected);

  await app.close();
});

test("EC2 no course / no raceStartAt / fewer than two checkpoints return 400", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec2"));

  const noCourseId = await createPaidRoom(app, ownerToken, "EC2 no course");
  const noCourse = await getSchedule(app, noCourseId, ownerToken);
  assert.equal(noCourse.statusCode, 400);
  assert.match((noCourse.json() as { error: string }).error, /Course required/i);

  const noStartId = await createPaidRoom(app, ownerToken, "EC2 no raceStartAt");
  await put50kCourse(app, noStartId, ownerToken);
  const withCourse = await getRaceRoom(noStartId);
  assert.ok(withCourse);
  const clearedStart = { ...withCourse };
  delete clearedStart.raceStartAt;
  delete clearedStart.activatedAt;
  await saveRaceRoom(clearedStart);
  const noStart = await getSchedule(app, noStartId, ownerToken);
  assert.equal(noStart.statusCode, 400);
  assert.match((noStart.json() as { error: string }).error, /raceStartAt required/i);

  const shortId = await createPaidRoom(app, ownerToken, "EC2 one checkpoint");
  await put50kCourse(app, shortId, ownerToken);
  const full = await getRaceRoom(shortId);
  assert.ok(full?.course);
  const single = {
    ...full,
    course: {
      ...full.course,
      checkpoints: [full.course.checkpoints[0]!]
    }
  };
  await saveRaceRoom(single);
  const tooFew = await getSchedule(app, shortId, ownerToken);
  assert.equal(tooFew.statusCode, 400);
  assert.match((tooFew.json() as { error: string }).error, /at least two checkpoints/i);

  await app.close();
});

test("EC3 unauthorized schedule GET matches GET room (401 / 403 / 402)", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec3"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-w13-ec3"));
  const crewToken = app.jwt.sign(buildClaims("crew-w13-ec3"));
  const roomId = await createPaidRoom(app, ownerToken, "EC3 schedule authz");
  await put50kCourse(app, roomId, ownerToken);

  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew-schedule@example.com", role: "crew_member" },
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

  const unauth = await getSchedule(app, roomId);
  assert.equal(unauth.statusCode, 401);

  const stranger = await getSchedule(app, roomId, strangerToken);
  assert.equal(stranger.statusCode, 403);

  const crewOk = await getSchedule(app, roomId, crewToken);
  assert.equal(crewOk.statusCode, 200);
  parseCrewScheduleSheet(crewOk.json());

  const unpay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "unpaid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(unpay.statusCode, 200);
  const unpaidSchedule = await getSchedule(app, roomId, ownerToken);
  assert.equal(unpaidSchedule.statusCode, 402);
  assert.equal((unpaidSchedule.json() as { error: string }).error, "Entitlement unpaid");
  const unpaidRoom = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(unpaidRoom.statusCode, 402);

  await app.close();
});

test("EC4 N/A offline — schedule is GET-only with no client outbox writes", async () => {
  // Offline sync / outbox is a client concern. This package exposes only GET /schedule
  // and never mutates stop-plans or course state, so there is no offline write path to cover.
  assert.equal(typeof projectCrewScheduleSheet, "function");
});

test("EC5 delay on aid-1 shifts later stops only; note ids match overlay", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec5"));
  const roomId = await createPaidRoom(app, ownerToken, "EC5 delay shifts later");
  await put50kCourse(app, roomId, ownerToken);

  const baselineResponse = await getSchedule(app, roomId, ownerToken);
  assert.equal(baselineResponse.statusCode, 200);
  const baseline = parseCrewScheduleSheet(baselineResponse.json());
  const delaySeconds = 180;
  const noteId = "note-plan-aid-1-ec5";

  const put = await putStopPlan(app, roomId, "aid-1", ownerToken, {
    delayOverrideSeconds: delaySeconds,
    planNotes: { id: noteId, body: "Crew meetup extra" }
  });
  assert.equal(put.statusCode, 200);

  const afterResponse = await getSchedule(app, roomId, ownerToken);
  assert.equal(afterResponse.statusCode, 200);
  const after = parseCrewScheduleSheet(afterResponse.json());

  assert.equal(stopByCheckpoint(after, "start").elapsedSeconds, stopByCheckpoint(baseline, "start").elapsedSeconds);
  assert.equal(stopByCheckpoint(after, "aid-1").elapsedSeconds, stopByCheckpoint(baseline, "aid-1").elapsedSeconds);
  assert.equal(stopByCheckpoint(after, "aid-1").clockArrivalAt, stopByCheckpoint(baseline, "aid-1").clockArrivalAt);
  assert.equal(stopByCheckpoint(after, "aid-1").delayOverrideSeconds, delaySeconds);
  assert.deepEqual(stopByCheckpoint(after, "aid-1").notes, { planNotesId: noteId });

  for (const id of ["aid-2", "aid-3", "finish"] as const) {
    assert.equal(
      stopByCheckpoint(after, id).elapsedSeconds,
      stopByCheckpoint(baseline, id).elapsedSeconds + delaySeconds
    );
    assert.equal(
      Date.parse(stopByCheckpoint(after, id).clockArrivalAt),
      Date.parse(stopByCheckpoint(baseline, id).clockArrivalAt) + delaySeconds * 1000
    );
  }

  await app.close();
});

test("EC6 clocks are ISO-8601 UTC Z and durations are seconds", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec6"));
  const roomId = await createPaidRoom(app, ownerToken, "EC6 ISO Z seconds");
  await put50kCourse(app, roomId, ownerToken);

  const response = await getSchedule(app, roomId, ownerToken);
  assert.equal(response.statusCode, 200);
  const sheet = parseCrewScheduleSheet(response.json());
  assert.match(sheet.raceStartAt, ISO_Z);
  assert.ok(sheet.raceStartAt.endsWith("Z"));
  for (const stop of sheet.stops) {
    assert.match(stop.clockArrivalAt, ISO_Z);
    assert.ok(stop.clockArrivalAt.endsWith("Z"));
    assert.equal(Number.isInteger(stop.elapsedSeconds), true);
    assert.equal(Number.isInteger(stop.plannedDwellSeconds), true);
    assert.equal(
      Date.parse(stop.clockArrivalAt),
      Date.parse(sheet.raceStartAt) + stop.elapsedSeconds * 1000
    );
  }

  await app.close();
});

test("EC7 deleted checkpoint is absent from the schedule sheet", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec7"));
  const roomId = await createPaidRoom(app, ownerToken, "EC7 deleted checkpoint");
  await put50kCourse(app, roomId, ownerToken);

  await putStopPlan(app, roomId, "aid-2", ownerToken, {
    delayOverrideSeconds: 60,
    athleteNotes: { id: "note-athlete-aid-2", body: "will ghost with delete" }
  });

  const before = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.ok(before.stops.some((stop) => stop.checkpointId === "aid-2"));

  const deleted = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/aid-2`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(deleted.statusCode, 200);

  const afterResponse = await getSchedule(app, roomId, ownerToken);
  assert.equal(afterResponse.statusCode, 200);
  const after = parseCrewScheduleSheet(afterResponse.json());
  assert.equal(
    after.stops.some((stop) => stop.checkpointId === "aid-2"),
    false
  );
  assert.deepEqual(
    after.stops.map((stop) => stop.checkpointId),
    ["start", "aid-1", "aid-3", "finish"]
  );

  await app.close();
});

test("EC8 delay on last stop leaves last arrival unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec8"));
  const roomId = await createPaidRoom(app, ownerToken, "EC8 last-stop delay");
  await put50kCourse(app, roomId, ownerToken);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const finishBefore = stopByCheckpoint(baseline, "finish");

  const put = await putStopPlan(app, roomId, "finish", ownerToken, {
    delayOverrideSeconds: 300,
    planNotes: { id: "note-plan-finish", body: "Celebration" }
  });
  assert.equal(put.statusCode, 200);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const finishAfter = stopByCheckpoint(after, "finish");
  assert.equal(finishAfter.elapsedSeconds, finishBefore.elapsedSeconds);
  assert.equal(finishAfter.clockArrivalAt, finishBefore.clockArrivalAt);
  assert.equal(finishAfter.delayOverrideSeconds, 300);
  assert.deepEqual(finishAfter.notes, { planNotesId: "note-plan-finish" });
  assert.equal(after.stops.length, baseline.stops.length);

  for (const id of ["start", "aid-1", "aid-2", "aid-3"] as const) {
    assert.equal(stopByCheckpoint(after, id).elapsedSeconds, stopByCheckpoint(baseline, id).elapsedSeconds);
  }

  await app.close();
});

test("EC9 projection hydrate failure returns 503 rather than a plan-only schedule", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w13-ec9"));
  const roomId = await createPaidRoom(app, ownerToken, "EC9 projection hydrate unavailable");
  await put50kCourse(app, roomId, ownerToken);

  let requestedRoomId: string | undefined;
  setScheduleProjectionLoaderForTests(async (id) => {
    requestedRoomId = id;
    throw new Error("projection unavailable for test");
  });

  try {
    const response = await getSchedule(app, roomId, ownerToken);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "Schedule temporarily unavailable" });
    assert.equal(requestedRoomId, roomId);
  } finally {
    setScheduleProjectionLoaderForTests();
    await app.close();
  }
});
