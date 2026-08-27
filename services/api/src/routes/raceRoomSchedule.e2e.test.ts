/**
 * W1-I (#381) cross-package schedule smoke:
 * seed 50k course → stop-plan delay → GET /schedule clock shift → clear → revert.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseCrewScheduleSheet, type CrewScheduleSheet, type RaceRoom } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const AID1_DELAY_SECONDS = 180;

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
  const room = response.json() as RaceRoom;
  assert.deepEqual(
    room.course?.checkpoints.map((checkpoint) => checkpoint.id),
    [...GOLDEN_CHECKPOINT_IDS]
  );
  return room;
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

/**
 * W1-3 clock policy:
 * - A stop’s own planned stoppage / delay does not shift its arrival.
 * - Later arrivals add cumulative prior planned stoppage + delay (delay is extra, not a stoppage replacement).
 */
function assertLaterStopsShifted(
  baseline: CrewScheduleSheet,
  after: CrewScheduleSheet,
  delaySeconds: number
) {
  const baselineAid1 = stopByCheckpoint(baseline, "aid-1");
  const afterAid1 = stopByCheckpoint(after, "aid-1");
  assert.ok(baselineAid1.plannedStoppageSeconds > 0, "fixture must expose prior stoppage so delay-extra is meaningful");
  assert.equal(afterAid1.plannedStoppageSeconds, baselineAid1.plannedStoppageSeconds);

  assert.equal(stopByCheckpoint(after, "start").elapsedSeconds, stopByCheckpoint(baseline, "start").elapsedSeconds);
  // Own stoppage/delay must not move aid-1 arrival.
  assert.equal(afterAid1.elapsedSeconds, baselineAid1.elapsedSeconds);
  assert.equal(afterAid1.clockArrivalAt, baselineAid1.clockArrivalAt);
  assert.equal(afterAid1.delayOverrideSeconds, delaySeconds);

  for (const id of ["aid-2", "aid-3", "finish"] as const) {
    const baselineStop = stopByCheckpoint(baseline, id);
    const afterStop = stopByCheckpoint(after, id);
    assert.equal(afterStop.elapsedSeconds, baselineStop.elapsedSeconds + delaySeconds);
    assert.equal(
      Date.parse(afterStop.clockArrivalAt),
      Date.parse(baselineStop.clockArrivalAt) + delaySeconds * 1000
    );
  }

  // Inter-stop gap grows by exactly the delay (prior stoppage remains in the baseline gap).
  const baselineGap =
    stopByCheckpoint(baseline, "aid-2").elapsedSeconds - baselineAid1.elapsedSeconds;
  const afterGap = stopByCheckpoint(after, "aid-2").elapsedSeconds - afterAid1.elapsedSeconds;
  assert.ok(baselineGap > baselineAid1.plannedStoppageSeconds, "aid-1→aid-2 gap must include prior stoppage + moving");
  assert.equal(afterGap, baselineGap + delaySeconds);
}

test("W1-I EC1 no delay overlay — schedule returns without delay fields", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w1i-ec1"));
  const roomId = await createPaidRoom(app, ownerToken, "W1-I EC1 baseline");
  await put50kCourse(app, roomId, ownerToken);

  const response = await getSchedule(app, roomId, ownerToken);
  assert.equal(response.statusCode, 200);
  const sheet = parseCrewScheduleSheet(response.json());
  assert.deepEqual(
    sheet.stops.map((stop) => stop.checkpointId),
    [...GOLDEN_CHECKPOINT_IDS]
  );
  for (const stop of sheet.stops) {
    assert.equal("delayOverrideSeconds" in stop, false);
    assert.equal("notes" in stop, false);
  }

  await app.close();
});

test("W1-I EC2 invalid delay returns 400 and leaves schedule unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w1i-ec2"));
  const roomId = await createPaidRoom(app, ownerToken, "W1-I EC2 invalid delay");
  await put50kCourse(app, roomId, ownerToken);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());

  for (const invalid of [-1, "180", true]) {
    const denied = await putStopPlan(app, roomId, "aid-1", ownerToken, {
      delayOverrideSeconds: invalid
    });
    assert.equal(denied.statusCode, 400, `expected 400 for ${String(invalid)}`);
  }

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(after, baseline);
  assert.equal("delayOverrideSeconds" in stopByCheckpoint(after, "aid-1"), false);

  await app.close();
});

test("W1-I EC3 unauthorized write leaves schedule unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w1i-ec3"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-w1i-ec3"));
  const crewToken = app.jwt.sign(buildClaims("crew-w1i-ec3"));
  const roomId = await createPaidRoom(app, ownerToken, "W1-I EC3 unauthorized write");
  await put50kCourse(app, roomId, ownerToken);

  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew-w1i@example.com", role: "crew_member" },
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

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const payload = { delayOverrideSeconds: AID1_DELAY_SECONDS };

  const unauth = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/stop-plans/aid-1`,
    payload
  });
  assert.equal(unauth.statusCode, 401);

  const stranger = await putStopPlan(app, roomId, "aid-1", strangerToken, payload);
  assert.equal(stranger.statusCode, 403);

  const crew = await putStopPlan(app, roomId, "aid-1", crewToken, payload);
  assert.equal(crew.statusCode, 403);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(after, baseline);

  await app.close();
});

test("W1-I EC4 N/A offline — in-process server E2E has no client outbox path", async () => {
  // Offline sync is a client concern. This integration package exercises in-process Fastify
  // inject only (seed → mutate → GET), so there is no offline write surface to assert.
  assert.equal(typeof getSchedule, "function");
});

test("W1-I EC5 delay then clear — later clocks shift then revert toward baseline", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w1i-ec5"));
  const roomId = await createPaidRoom(app, ownerToken, "W1-I EC5 delay then clear");
  await put50kCourse(app, roomId, ownerToken);

  const baselineResponse = await getSchedule(app, roomId, ownerToken);
  assert.equal(baselineResponse.statusCode, 200);
  const baseline = parseCrewScheduleSheet(baselineResponse.json());

  const put = await putStopPlan(app, roomId, "aid-1", ownerToken, {
    delayOverrideSeconds: AID1_DELAY_SECONDS,
    planNotes: { id: "note-w1i-aid-1", body: "Crew meetup extra" }
  });
  assert.equal(put.statusCode, 200);

  const delayedResponse = await getSchedule(app, roomId, ownerToken);
  assert.equal(delayedResponse.statusCode, 200);
  const delayed = parseCrewScheduleSheet(delayedResponse.json());
  assertLaterStopsShifted(baseline, delayed, AID1_DELAY_SECONDS);
  assert.deepEqual(stopByCheckpoint(delayed, "aid-1").notes, { planNotesId: "note-w1i-aid-1" });

  const clear = await putStopPlan(app, roomId, "aid-1", ownerToken, {
    delayOverrideSeconds: null,
    planNotes: null
  });
  assert.equal(clear.statusCode, 200);

  const clearedResponse = await getSchedule(app, roomId, ownerToken);
  assert.equal(clearedResponse.statusCode, 200);
  const cleared = parseCrewScheduleSheet(clearedResponse.json());
  assert.deepEqual(cleared, baseline);
  assert.equal("delayOverrideSeconds" in stopByCheckpoint(cleared, "aid-1"), false);

  await app.close();
});

test("W1-I EC6 units — ISO Z clocks and integer seconds", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w1i-ec6"));
  const roomId = await createPaidRoom(app, ownerToken, "W1-I EC6 units");
  await put50kCourse(app, roomId, ownerToken);

  await putStopPlan(app, roomId, "aid-1", ownerToken, { delayOverrideSeconds: AID1_DELAY_SECONDS });
  const response = await getSchedule(app, roomId, ownerToken);
  assert.equal(response.statusCode, 200);
  const sheet = parseCrewScheduleSheet(response.json());
  assert.match(sheet.raceStartAt, ISO_Z);
  assert.ok(sheet.raceStartAt.endsWith("Z"));
  for (const stop of sheet.stops) {
    assert.match(stop.clockArrivalAt, ISO_Z);
    assert.ok(stop.clockArrivalAt.endsWith("Z"));
    assert.equal(Number.isInteger(stop.elapsedSeconds), true);
    assert.equal(Number.isInteger(stop.plannedStoppageSeconds), true);
    assert.equal(
      Date.parse(stop.clockArrivalAt),
      Date.parse(sheet.raceStartAt) + stop.elapsedSeconds * 1000
    );
  }
  assert.equal(stopByCheckpoint(sheet, "aid-1").delayOverrideSeconds, AID1_DELAY_SECONDS);

  await app.close();
});

test("W1-I EC7 deleted checkpoint is absent from schedule", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w1i-ec7"));
  const roomId = await createPaidRoom(app, ownerToken, "W1-I EC7 deleted checkpoint");
  await put50kCourse(app, roomId, ownerToken);

  const noDelay = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const aid2Stoppage = stopByCheckpoint(noDelay, "aid-2").plannedStoppageSeconds;
  assert.ok(aid2Stoppage > 0, "deleted-stop stoppage must be non-zero so EC7 proves cumulative removal");

  await putStopPlan(app, roomId, "aid-2", ownerToken, { delayOverrideSeconds: 60 });
  const before = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.ok(before.stops.some((stop) => stop.checkpointId === "aid-2"));
  assert.equal(
    stopByCheckpoint(before, "aid-3").elapsedSeconds,
    stopByCheckpoint(noDelay, "aid-3").elapsedSeconds + 60
  );

  const deleted = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/aid-2`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(deleted.statusCode, 200);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.equal(
    after.stops.some((stop) => stop.checkpointId === "aid-2"),
    false
  );
  assert.deepEqual(
    after.stops.map((stop) => stop.checkpointId),
    ["start", "aid-1", "aid-3", "finish"]
  );
  // Deleting aid-2 removes its prior stoppage + delay from later arrivals (not a no-op vs noDelay).
  assert.equal(
    stopByCheckpoint(after, "aid-3").elapsedSeconds,
    stopByCheckpoint(before, "aid-3").elapsedSeconds - aid2Stoppage - 60
  );
  assert.equal(
    stopByCheckpoint(after, "finish").elapsedSeconds,
    stopByCheckpoint(before, "finish").elapsedSeconds - aid2Stoppage - 60
  );
  assert.equal(
    stopByCheckpoint(after, "aid-3").elapsedSeconds,
    stopByCheckpoint(noDelay, "aid-3").elapsedSeconds - aid2Stoppage
  );

  await app.close();
});
