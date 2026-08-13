/**
 * W2-1 (#383): check-in arrival/departure → reproject future GET /schedule ETAs.
 *
 * Incomplete visit policy: open visits (arrival only / null activeActualStopSeconds)
 * are omitted from closed-actual inputs and do not shift ETAs. Missing arrival or
 * departure on POST /manual-stop → 400; schedule unchanged.
 * Projection is absolute (latest closed actual per checkpoint, manual preferred), so
 * idempotent replay / LWW cannot double-apply a shift by summing visits.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrewScheduleSheet,
  type CrewScheduleSheet,
  type RaceCheckpointSplitRow,
  type RaceRoom
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { getRaceRoom } from "./raceRooms.js";
import {
  closedActualStopSecondsByCheckpointId,
  projectCrewScheduleSheet
} from "./raceRoomSchedule.js";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const AID1_PLANNED_DWELL = 600;

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

async function postManualStop(
  app: TestApp,
  roomId: string,
  checkpointId: string,
  token: string,
  payload: object,
  extraHeaders?: Record<string, string>
) {
  return app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/${checkpointId}/manual-stop`,
    payload,
    headers: { authorization: `Bearer ${token}`, ...extraHeaders }
  });
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

function assertLaterStopsShiftedBy(
  baseline: CrewScheduleSheet,
  after: CrewScheduleSheet,
  deltaSeconds: number,
  checkInCheckpointId = "aid-1"
) {
  const earlierIds = GOLDEN_CHECKPOINT_IDS.filter(
    (id) =>
      stopByCheckpoint(baseline, id).elapsedSeconds <=
      stopByCheckpoint(baseline, checkInCheckpointId).elapsedSeconds
  );
  for (const id of earlierIds) {
    assert.equal(
      stopByCheckpoint(after, id).elapsedSeconds,
      stopByCheckpoint(baseline, id).elapsedSeconds,
      `${id} must not shift from own/prior check-in dwell`
    );
    assert.equal(
      stopByCheckpoint(after, id).clockArrivalAt,
      stopByCheckpoint(baseline, id).clockArrivalAt
    );
  }

  const laterIds = GOLDEN_CHECKPOINT_IDS.filter(
    (id) =>
      stopByCheckpoint(baseline, id).elapsedSeconds >
      stopByCheckpoint(baseline, checkInCheckpointId).elapsedSeconds
  );
  for (const id of laterIds) {
    assert.equal(
      stopByCheckpoint(after, id).elapsedSeconds,
      stopByCheckpoint(baseline, id).elapsedSeconds + deltaSeconds,
      `${id} elapsed shift`
    );
    assert.equal(
      Date.parse(stopByCheckpoint(after, id).clockArrivalAt),
      Date.parse(stopByCheckpoint(baseline, id).clockArrivalAt) + deltaSeconds * 1000,
      `${id} clock shift`
    );
  }
}

test("W2-1 helper omits incomplete visits from closed-actual map", () => {
  const splits: RaceCheckpointSplitRow[] = [
    {
      checkpointId: "aid-1",
      distanceMetersFromStart: 10_000,
      crossedAtRecordedAt: null,
      plannedElapsedSecondsAtCross: 1000,
      actualElapsedSecondsAtCross: null,
      deltaSecondsAtCross: null,
      plannedStopSeconds: 600,
      visits: [
        {
          visitIndex: 1,
          resolvedSource: "auto",
          autoDetected: {
            arrivalRecordedAt: "2026-08-15T14:00:00.000Z",
            departureRecordedAt: null,
            firstSlowedAt: null,
            actualStopSeconds: null
          },
          activeActualStopSeconds: null
        }
      ],
      totalActualStopSeconds: null,
      deltaStopSeconds: null
    },
    {
      checkpointId: "aid-2",
      distanceMetersFromStart: 20_000,
      crossedAtRecordedAt: null,
      plannedElapsedSecondsAtCross: 2000,
      actualElapsedSecondsAtCross: null,
      deltaSecondsAtCross: null,
      plannedStopSeconds: 600,
      visits: [
        {
          visitIndex: 1,
          resolvedSource: "manual_crew",
          manualEntry: {
            arrivalAt: "2026-08-15T15:00:00.000Z",
            departureAt: "2026-08-15T15:15:00.000Z",
            actualStopSeconds: 900,
            recordedByUserId: "crew-1"
          },
          activeActualStopSeconds: 900
        }
      ],
      totalActualStopSeconds: 900,
      deltaStopSeconds: 300
    }
  ];

  const map = closedActualStopSecondsByCheckpointId(splits);
  assert.equal(map.has("aid-1"), false, "incomplete visit must not enter closed map");
  assert.equal(map.get("aid-2"), 900);
});

test("W2-1 helper last-write-wins: closed auto + manual does not sum (EC4)", () => {
  const splits: RaceCheckpointSplitRow[] = [
    {
      checkpointId: "aid-1",
      distanceMetersFromStart: 10_000,
      crossedAtRecordedAt: null,
      plannedElapsedSecondsAtCross: 1000,
      actualElapsedSecondsAtCross: null,
      deltaSecondsAtCross: null,
      plannedStopSeconds: 600,
      visits: [
        {
          visitIndex: 1,
          resolvedSource: "auto",
          autoDetected: {
            arrivalRecordedAt: "2026-08-15T12:00:00.000Z",
            departureRecordedAt: "2026-08-15T12:01:40.000Z",
            firstSlowedAt: null,
            actualStopSeconds: 100
          },
          activeActualStopSeconds: 100
        },
        {
          visitIndex: 2,
          resolvedSource: "manual_crew",
          manualEntry: {
            arrivalAt: "2026-08-15T14:00:00.000Z",
            departureAt: "2026-08-15T14:15:00.000Z",
            actualStopSeconds: 900,
            recordedByUserId: "crew-1"
          },
          activeActualStopSeconds: 900
        }
      ],
      totalActualStopSeconds: 1000,
      deltaStopSeconds: 400
    }
  ];

  const map = closedActualStopSecondsByCheckpointId(splits);
  assert.equal(map.get("aid-1"), 900, "manual_crew closed actual must win; must not sum 100+900");
});

test("W2-1 helper last-write-wins: latest closed auto when no manual", () => {
  const splits: RaceCheckpointSplitRow[] = [
    {
      checkpointId: "aid-1",
      distanceMetersFromStart: 10_000,
      crossedAtRecordedAt: null,
      plannedElapsedSecondsAtCross: 1000,
      actualElapsedSecondsAtCross: null,
      deltaSecondsAtCross: null,
      plannedStopSeconds: 600,
      visits: [
        {
          visitIndex: 1,
          resolvedSource: "auto",
          autoDetected: {
            arrivalRecordedAt: "2026-08-15T12:00:00.000Z",
            departureRecordedAt: "2026-08-15T12:01:00.000Z",
            firstSlowedAt: null,
            actualStopSeconds: 60
          },
          activeActualStopSeconds: 60
        },
        {
          visitIndex: 2,
          resolvedSource: "auto",
          autoDetected: {
            arrivalRecordedAt: "2026-08-15T13:00:00.000Z",
            departureRecordedAt: "2026-08-15T13:05:00.000Z",
            firstSlowedAt: null,
            actualStopSeconds: 300
          },
          activeActualStopSeconds: 300
        }
      ],
      totalActualStopSeconds: 360,
      deltaStopSeconds: -240
    }
  ];

  const map = closedActualStopSecondsByCheckpointId(splits);
  assert.equal(map.get("aid-1"), 300, "latest closed auto wins; must not sum");
});

test("W2-1 EC1 missing arrival/departure → 400; schedule unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec1"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC1 missing fields");
  await put50kCourse(app, roomId, ownerToken);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());

  const missingDeparture = await postManualStop(app, roomId, "aid-1", ownerToken, {
    arrivalAt: "2026-08-15T14:00:00.000Z"
  });
  assert.equal(missingDeparture.statusCode, 400);

  const missingArrival = await postManualStop(app, roomId, "aid-1", ownerToken, {
    departureAt: "2026-08-15T14:10:00.000Z"
  });
  assert.equal(missingArrival.statusCode, 400);

  const empty = await postManualStop(app, roomId, "aid-1", ownerToken, {});
  assert.equal(empty.statusCode, 400);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(after, baseline);

  await app.close();
});

test("W2-1 incomplete visit (open actual) does not shift schedule (documented no-op)", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-incomplete"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 incomplete visit");
  const seeded = await put50kCourse(app, roomId, ownerToken);

  const baseline = projectCrewScheduleSheet(seeded);
  const withOpenOnly = projectCrewScheduleSheet(seeded, {
    closedActualStopSecondsByCheckpointId: new Map()
  });
  assert.deepEqual(withOpenOnly, baseline, "empty closed map ≡ incomplete visits ≡ plan path");

  const httpBaseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(httpBaseline.stops.map((s) => s.elapsedSeconds), baseline.stops.map((s) => s.elapsedSeconds));

  await app.close();
});

test("W2-1 EC2 invalid times → 400; schedule unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec2"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC2 invalid times");
  await put50kCourse(app, roomId, ownerToken);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());

  const departureBeforeArrival = await postManualStop(app, roomId, "aid-1", ownerToken, {
    arrivalAt: "2026-08-15T14:10:00.000Z",
    departureAt: "2026-08-15T14:00:00.000Z"
  });
  assert.equal(departureBeforeArrival.statusCode, 400);

  const equalTimes = await postManualStop(app, roomId, "aid-1", ownerToken, {
    arrivalAt: "2026-08-15T14:00:00.000Z",
    departureAt: "2026-08-15T14:00:00.000Z"
  });
  assert.equal(equalTimes.statusCode, 400);

  const badIso = await postManualStop(app, roomId, "aid-1", ownerToken, {
    arrivalAt: "not-a-time",
    departureAt: "2026-08-15T14:10:00.000Z"
  });
  assert.equal(badIso.statusCode, 400);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(after, baseline);

  await app.close();
});

test("W2-1 EC3 unauthorized / unpaid write leaves schedule unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec3"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-w21-ec3"));
  const athleteToken = app.jwt.sign(buildClaims("athlete-w21-ec3"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC3 authz");
  await put50kCourse(app, roomId, ownerToken);

  const inviteAthlete = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "athlete-w21@example.com", role: "athlete" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(inviteAthlete.statusCode, 201);
  const acceptAthlete = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (inviteAthlete.json() as { token: string }).token },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(acceptAthlete.statusCode, 200);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const payload = {
    arrivalAt: "2026-08-15T14:00:00.000Z",
    departureAt: "2026-08-15T14:20:00.000Z"
  };

  const unauth = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/aid-1/manual-stop`,
    payload
  });
  assert.equal(unauth.statusCode, 401);

  const stranger = await postManualStop(app, roomId, "aid-1", strangerToken, payload);
  assert.equal(stranger.statusCode, 403);

  const athleteDenied = await postManualStop(app, roomId, "aid-1", athleteToken, payload);
  assert.equal(athleteDenied.statusCode, 403);

  const afterDenied = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(afterDenied, baseline);

  const unpay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "unpaid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(unpay.statusCode, 200);
  const unpaidWrite = await postManualStop(app, roomId, "aid-1", ownerToken, payload);
  assert.equal(unpaidWrite.statusCode, 402);

  // Members still cannot GET schedule when unpaid (entitlement gate).
  const unpaidGet = await getSchedule(app, roomId, ownerToken);
  assert.equal(unpaidGet.statusCode, 402);

  await app.close();
});

test("W2-1 EC4/EC5 idempotent replay does not double-apply ETA shift; last-write-wins without key", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec45"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC4/5 idempotent");
  await put50kCourse(app, roomId, ownerToken);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const actualStopSeconds = AID1_PLANNED_DWELL + 240;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();
  const payload = { arrivalAt, departureAt };
  const idemHeaders = { "idempotency-key": "w21-manual-stop-aid1" };

  const first = await postManualStop(app, roomId, "aid-1", ownerToken, payload, idemHeaders);
  assert.equal(first.statusCode, 200);

  const afterFirst = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assertLaterStopsShiftedBy(baseline, afterFirst, 240);

  const replay = await postManualStop(app, roomId, "aid-1", ownerToken, payload, idemHeaders);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());

  const afterReplay = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.deepEqual(afterReplay, afterFirst, "idempotent replay must not double-shift");

  // Last-write-wins: different payload without key overwrites actual; schedule uses latest absolute actual.
  const shorterActual = AID1_PLANNED_DWELL + 60;
  const rewrite = await postManualStop(app, roomId, "aid-1", ownerToken, {
    arrivalAt,
    departureAt: new Date(Date.parse(arrivalAt) + shorterActual * 1000).toISOString()
  });
  assert.equal(rewrite.statusCode, 200);
  const afterRewrite = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assertLaterStopsShiftedBy(baseline, afterRewrite, 60);

  await app.close();
});

test("W2-1 EC6 clocks remain ISO-8601 UTC Z; durations in seconds after check-in", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec6"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC6 units");
  await put50kCourse(app, roomId, ownerToken);

  const actualStopSeconds = AID1_PLANNED_DWELL + 120;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();
  const posted = await postManualStop(app, roomId, "aid-1", ownerToken, { arrivalAt, departureAt });
  assert.equal(posted.statusCode, 200);

  const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.match(sheet.raceStartAt, ISO_Z);
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

test("W2-1 EC7 mid-course aid check-in shifts later stops only; own arrival unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec7"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC7 mid-course");
  await put50kCourse(app, roomId, ownerToken);

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.equal(stopByCheckpoint(baseline, "aid-1").plannedDwellSeconds, AID1_PLANNED_DWELL);

  const deltaSeconds = 300;
  const actualStopSeconds = AID1_PLANNED_DWELL + deltaSeconds;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();

  const posted = await postManualStop(app, roomId, "aid-1", ownerToken, { arrivalAt, departureAt });
  assert.equal(posted.statusCode, 200);
  const body = posted.json() as {
    checkpointSplit: { visits: Array<{ activeActualStopSeconds: number | null }> };
  };
  assert.equal(body.checkpointSplit.visits[0]?.activeActualStopSeconds, actualStopSeconds);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assertLaterStopsShiftedBy(baseline, after, deltaSeconds, "aid-1");

  // Golden: absolute elapsed for aid-2 equals projector with closed actual map.
  const room = await getRaceRoom(roomId);
  assert.ok(room);
  const expected = projectCrewScheduleSheet(room, {
    closedActualStopSecondsByCheckpointId: { "aid-1": actualStopSeconds }
  });
  assert.deepEqual(after.stops, expected.stops);

  await app.close();
});

test("W2-1 EC8 check-in + delayOverride combines without double-counting delay", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-ec8"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 EC8 delay+checkin");
  await put50kCourse(app, roomId, ownerToken);

  const planOnly = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  const delaySeconds = 180;
  const put = await putStopPlan(app, roomId, "aid-1", ownerToken, {
    delayOverrideSeconds: delaySeconds
  });
  assert.equal(put.statusCode, 200);

  const withDelay = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assertLaterStopsShiftedBy(planOnly, withDelay, delaySeconds);

  // actual = planned + delay + extra → later stops move by `extra` vs delay-baseline
  // (not planned+delay+extra again).
  const extraBeyondPlanAndDelay = 90;
  const actualStopSeconds = AID1_PLANNED_DWELL + delaySeconds + extraBeyondPlanAndDelay;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();
  const posted = await postManualStop(app, roomId, "aid-1", ownerToken, { arrivalAt, departureAt });
  assert.equal(posted.statusCode, 200);

  const afterCheckin = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
  assert.equal(stopByCheckpoint(afterCheckin, "aid-1").delayOverrideSeconds, delaySeconds);
  assert.equal(
    stopByCheckpoint(afterCheckin, "aid-1").elapsedSeconds,
    stopByCheckpoint(withDelay, "aid-1").elapsedSeconds,
    "own arrival not shifted by own actual dwell"
  );
  assertLaterStopsShiftedBy(withDelay, afterCheckin, extraBeyondPlanAndDelay);

  // vs plan-only: total shift = delay + extra (delay counted once via actual replacement)
  assertLaterStopsShiftedBy(planOnly, afterCheckin, delaySeconds + extraBeyondPlanAndDelay);

  await app.close();
});

test("W2-1 crew_member may write check-in and GET schedule reflects shift", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w21-crew"));
  const crewToken = app.jwt.sign(buildClaims("crew-w21-crew"));
  const roomId = await createPaidRoom(app, ownerToken, "W2-1 crew write");
  await put50kCourse(app, roomId, ownerToken);

  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew-w21@example.com", role: "crew_member" },
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

  const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, crewToken)).json());
  const deltaSeconds = 150;
  const actualStopSeconds = AID1_PLANNED_DWELL + deltaSeconds;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();

  const posted = await postManualStop(app, roomId, "aid-1", crewToken, { arrivalAt, departureAt });
  assert.equal(posted.statusCode, 200);

  const after = parseCrewScheduleSheet((await getSchedule(app, roomId, crewToken)).json());
  assertLaterStopsShiftedBy(baseline, after, deltaSeconds);

  await app.close();
});
