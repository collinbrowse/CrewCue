/**
 * W3-4 (#401): attach PacingEstimate as plan of record → GET /schedule baseline.
 *
 * Policy: estimate moving times (aid/finish) replace pace-based moving baseline;
 * planned dwell, delay overrides, and closed check-in actuals still shift later clocks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrewScheduleSheet,
  parsePacingEstimate,
  type CrewScheduleSheet,
  type PacingEstimate,
  type RaceRoom
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetActivityHistoryStoreForTests } from "../lib/activityHistoryStore.js";
import { resetPacingEstimateStoreForTests, savePacingEstimate } from "../lib/pacingEstimateStore.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import { getRaceRoom, saveRaceRoom } from "./raceRooms.js";
import { projectCrewScheduleSheet } from "./raceRoomSchedule.js";

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

async function attachEstimate(
  app: TestApp,
  roomId: string,
  token: string,
  payload: object
) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/pacing-estimate`,
    payload,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function createEstimateViaApi(
  app: TestApp,
  token: string,
  room: RaceRoom
): Promise<PacingEstimate> {
  assert.ok(room.course?.checkpoints);
  const response = await app.inject({
    method: "POST",
    url: "/pacing-estimates",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      raceStartAt: RACE_START_AT,
      checkpoints: room.course.checkpoints
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  return parsePacingEstimate(response.json());
}

function stopByCheckpoint(sheet: CrewScheduleSheet, checkpointId: string) {
  const stop = sheet.stops.find((row) => row.checkpointId === checkpointId);
  assert.ok(stop, `missing schedule stop ${checkpointId}`);
  return stop;
}

async function withApp(run: (ctx: { app: TestApp; tokenFor: (sub: string) => string }) => Promise<void>) {
  await resetActivityHistoryStoreForTests();
  await resetPacingEstimateStoreForTests();
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
    await resetPacingEstimateStoreForTests();
  }
}

test("EC1 no estimate attached — schedule unchanged from pace baseline", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec1");
    const roomId = await createPaidRoom(app, ownerToken, "EC1 no estimate");
    const seeded = await put50kCourse(app, roomId, ownerToken);

    const response = await getSchedule(app, roomId, ownerToken);
    assert.equal(response.statusCode, 200);
    const sheet = parseCrewScheduleSheet(response.json());
    assert.equal(sheet.pacingEstimateId, undefined);
    assert.deepEqual(sheet, projectCrewScheduleSheet(seeded));
  });
});

test("EC2 invalid estimate id / body returns 400", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec2");
    const roomId = await createPaidRoom(app, ownerToken, "EC2 invalid attach");
    await put50kCourse(app, roomId, ownerToken);

    const missingId = await attachEstimate(app, roomId, ownerToken, {
      pacingEstimateId: "est_does_not_exist"
    });
    assert.equal(missingId.statusCode, 400);
    assert.equal((missingId.json() as { code?: string }).code, "invalid_estimate_id");

    const empty = await attachEstimate(app, roomId, ownerToken, {});
    assert.equal(empty.statusCode, 400);

    const badBody = await attachEstimate(app, roomId, ownerToken, {
      estimate: { id: "x", coldStart: true }
    });
    assert.equal(badBody.statusCode, 400);
    assert.equal((badBody.json() as { code?: string }).code, "invalid_estimate_body");
  });
});

test("EC3 unauthorized attach returns 401/403; cannot attach another athlete estimate", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec3");
    const otherToken = tokenFor("other-athlete-w34-ec3");
    const strangerToken = tokenFor("stranger-w34-ec3");
    const crewToken = tokenFor("crew-w34-ec3");

    const roomId = await createPaidRoom(app, ownerToken, "EC3 authz attach");
    const room = await put50kCourse(app, roomId, ownerToken);
    const ownerEstimate = await createEstimateViaApi(app, ownerToken, room);
    const otherEstimate = await createEstimateViaApi(app, otherToken, room);

    const unauth = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/pacing-estimate`,
      payload: { pacingEstimateId: ownerEstimate.id }
    });
    assert.equal(unauth.statusCode, 401);

    const stranger = await attachEstimate(app, roomId, strangerToken, {
      pacingEstimateId: ownerEstimate.id
    });
    assert.equal(stranger.statusCode, 403);

    const invite = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites`,
      payload: { email: "crew-w34@example.com", role: "crew_member" },
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

    const crewAttach = await attachEstimate(app, roomId, crewToken, {
      pacingEstimateId: ownerEstimate.id
    });
    assert.equal(crewAttach.statusCode, 403);

    const foreign = await attachEstimate(app, roomId, ownerToken, {
      pacingEstimateId: otherEstimate.id
    });
    assert.equal(foreign.statusCode, 403);
  });
});

test("EC4 N/A offline — attach + schedule are in-process HTTP only", async () => {
  assert.equal(typeof projectCrewScheduleSheet, "function");
});

test("EC5 re-attach same estimate is idempotent", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec5");
    const roomId = await createPaidRoom(app, ownerToken, "EC5 idempotent attach");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await createEstimateViaApi(app, ownerToken, room);

    const first = await attachEstimate(app, roomId, ownerToken, {
      pacingEstimateId: estimate.id
    });
    assert.equal(first.statusCode, 200);
    const second = await attachEstimate(app, roomId, ownerToken, {
      pacingEstimateId: estimate.id
    });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(first.json(), second.json());

    const persisted = await getRaceRoom(roomId);
    assert.equal(persisted?.pacingEstimateId, estimate.id);
    assert.equal(persisted?.pacingEstimate?.id, estimate.id);
  });
});

test("EC6 estimate-backed clocks remain ISO-Z; aid/finish match estimate moving + dwell stack", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec6");
    const roomId = await createPaidRoom(app, ownerToken, "EC6 iso clocks");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await createEstimateViaApi(app, ownerToken, room);

    const attach = await attachEstimate(app, roomId, ownerToken, {
      pacingEstimateId: estimate.id
    });
    assert.equal(attach.statusCode, 200);

    const response = await getSchedule(app, roomId, ownerToken);
    assert.equal(response.statusCode, 200);
    const sheet = parseCrewScheduleSheet(response.json());
    assert.equal(sheet.pacingEstimateId, estimate.id);

    for (const stop of sheet.stops) {
      assert.match(stop.clockArrivalAt, ISO_Z);
    }

    // Moving baselines from estimate; dwell from prior stops still stacks.
    const startDwell = stopByCheckpoint(sheet, "start").plannedDwellSeconds;
    const aid1Eta = estimate.aidEtas.find((row) => row.checkpointId === "aid-1");
    assert.ok(aid1Eta);
    assert.equal(
      stopByCheckpoint(sheet, "aid-1").elapsedSeconds,
      aid1Eta.elapsedSeconds + startDwell
    );

    const aid1 = stopByCheckpoint(sheet, "aid-1");
    const aid2Eta = estimate.aidEtas.find((row) => row.checkpointId === "aid-2");
    assert.ok(aid2Eta);
    assert.equal(
      stopByCheckpoint(sheet, "aid-2").elapsedSeconds,
      aid2Eta.elapsedSeconds + startDwell + aid1.plannedDwellSeconds
    );

    const finishMoving = estimate.expectedFinishElapsedSeconds;
    let priorDwell = 0;
    for (const id of GOLDEN_CHECKPOINT_IDS) {
      if (id === "finish") break;
      const stop = stopByCheckpoint(sheet, id);
      priorDwell += stop.plannedDwellSeconds + (stop.delayOverrideSeconds ?? 0);
    }
    assert.equal(stopByCheckpoint(sheet, "finish").elapsedSeconds, finishMoving + priorDwell);
  });
});

test("EC7 estimate + delay overlay shifts later clocks", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec7");
    const roomId = await createPaidRoom(app, ownerToken, "EC7 estimate+delay");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await createEstimateViaApi(app, ownerToken, room);
    assert.equal(
      (await attachEstimate(app, roomId, ownerToken, { pacingEstimateId: estimate.id })).statusCode,
      200
    );

    const baselineResponse = await getSchedule(app, roomId, ownerToken);
    assert.equal(baselineResponse.statusCode, 200);
    const baseline = parseCrewScheduleSheet(baselineResponse.json());

    const delaySeconds = 180;
    const put = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/stop-plans/aid-1`,
      payload: { delayOverrideSeconds: delaySeconds },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(put.statusCode, 200);

    const afterResponse = await getSchedule(app, roomId, ownerToken);
    assert.equal(afterResponse.statusCode, 200);
    const after = parseCrewScheduleSheet(afterResponse.json());
    assert.equal(after.pacingEstimateId, estimate.id);

    assert.equal(stopByCheckpoint(after, "start").elapsedSeconds, stopByCheckpoint(baseline, "start").elapsedSeconds);
    assert.equal(stopByCheckpoint(after, "aid-1").elapsedSeconds, stopByCheckpoint(baseline, "aid-1").elapsedSeconds);
    assert.equal(
      stopByCheckpoint(after, "aid-2").elapsedSeconds,
      stopByCheckpoint(baseline, "aid-2").elapsedSeconds + delaySeconds
    );
    assert.equal(
      stopByCheckpoint(after, "finish").elapsedSeconds,
      stopByCheckpoint(baseline, "finish").elapsedSeconds + delaySeconds
    );
  });
});

test("EC8 estimate + closed check-in actual shifts later clocks", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-ec8");
    const roomId = await createPaidRoom(app, ownerToken, "EC8 estimate+checkin");
    const room = await put50kCourse(app, roomId, ownerToken);
    const estimate = await createEstimateViaApi(app, ownerToken, room);
    assert.equal(
      (await attachEstimate(app, roomId, ownerToken, { pacingEstimateId: estimate.id })).statusCode,
      200
    );

    const baselineResponse = await getSchedule(app, roomId, ownerToken);
    assert.equal(baselineResponse.statusCode, 200);
    const baseline = parseCrewScheduleSheet(baselineResponse.json());
    const plannedAid1 =
      stopByCheckpoint(baseline, "aid-1").plannedDwellSeconds +
      (stopByCheckpoint(baseline, "aid-1").delayOverrideSeconds ?? 0);
    const deltaSeconds = 240;
    const actualStopSeconds = plannedAid1 + deltaSeconds;
    const arrivalAt = "2026-08-15T14:00:00.000Z";
    const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();

    const checkIn = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/checkpoints/aid-1/manual-stop`,
      payload: { arrivalAt, departureAt },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(checkIn.statusCode, 200, checkIn.body);

    const afterResponse = await getSchedule(app, roomId, ownerToken);
    assert.equal(afterResponse.statusCode, 200);
    const after = parseCrewScheduleSheet(afterResponse.json());
    assert.equal(after.pacingEstimateId, estimate.id);

    assert.equal(stopByCheckpoint(after, "aid-1").elapsedSeconds, stopByCheckpoint(baseline, "aid-1").elapsedSeconds);
    assert.equal(
      stopByCheckpoint(after, "aid-2").elapsedSeconds,
      stopByCheckpoint(baseline, "aid-2").elapsedSeconds + deltaSeconds
    );
    assert.equal(
      stopByCheckpoint(after, "finish").elapsedSeconds,
      stopByCheckpoint(baseline, "finish").elapsedSeconds + deltaSeconds
    );
  });
});

test("attach by estimate body works and seeds store ownership", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-body");
    const roomId = await createPaidRoom(app, ownerToken, "attach by body");
    await put50kCourse(app, roomId, ownerToken);

    const estimate = parsePacingEstimate({
      id: "est_manual_body_attach",
      coldStart: true,
      expectedFinishAt: "2026-08-15T20:00:00.000Z",
      expectedFinishElapsedSeconds: 25_200,
      aidEtas: [
        {
          checkpointId: "aid-1",
          clockArrivalAt: "2026-08-15T15:00:00.000Z",
          elapsedSeconds: 7200
        },
        {
          checkpointId: "aid-2",
          clockArrivalAt: "2026-08-15T16:30:00.000Z",
          elapsedSeconds: 12_600
        },
        {
          checkpointId: "aid-3",
          clockArrivalAt: "2026-08-15T18:00:00.000Z",
          elapsedSeconds: 18_000
        }
      ],
      explanation: "Manual cold-start body for attach test."
    });

    const attach = await attachEstimate(app, roomId, ownerToken, { estimate });
    assert.equal(attach.statusCode, 200);

    const sheet = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.equal(sheet.pacingEstimateId, estimate.id);
    const startDwell = stopByCheckpoint(sheet, "start").plannedDwellSeconds;
    assert.equal(stopByCheckpoint(sheet, "aid-1").elapsedSeconds, 7200 + startDwell);

    // Re-attach by id after body seeded the store.
    const again = await attachEstimate(app, roomId, ownerToken, {
      pacingEstimateId: estimate.id
    });
    assert.equal(again.statusCode, 200);
  });
});

test("foreign athlete cannot attach estimate body they do not own when id exists", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-body-foreign");
    const otherToken = tokenFor("other-w34-body-foreign");
    const roomId = await createPaidRoom(app, ownerToken, "foreign body");
    await put50kCourse(app, roomId, ownerToken);

    const estimate = parsePacingEstimate({
      id: "est_owned_by_other",
      coldStart: true,
      expectedFinishAt: "2026-08-15T20:00:00.000Z",
      expectedFinishElapsedSeconds: 25_200,
      aidEtas: [],
      explanation: "Owned by other athlete."
    });
    await savePacingEstimate("other-w34-body-foreign", estimate);

    const forbidden = await attachEstimate(app, roomId, ownerToken, { estimate });
    assert.equal(forbidden.statusCode, 403);

    // Owner of estimate who is not a room editor also cannot attach.
    const notMember = await attachEstimate(app, roomId, otherToken, {
      pacingEstimateId: estimate.id
    });
    assert.equal(notMember.statusCode, 403);
  });
});

test("clearing room estimate field restores pace baseline (unit)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const ownerToken = tokenFor("owner-w34-clear");
    const roomId = await createPaidRoom(app, ownerToken, "clear estimate");
    const seeded = await put50kCourse(app, roomId, ownerToken);
    const estimate = await createEstimateViaApi(app, ownerToken, seeded);
    await attachEstimate(app, roomId, ownerToken, { pacingEstimateId: estimate.id });

    const withEstimate = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.ok(withEstimate.pacingEstimateId);

    const room = await getRaceRoom(roomId);
    assert.ok(room);
    const cleared = { ...room };
    delete cleared.pacingEstimate;
    delete cleared.pacingEstimateId;
    await saveRaceRoom(cleared);

    const without = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.equal(without.pacingEstimateId, undefined);
    assert.deepEqual(without, projectCrewScheduleSheet(cleared));
  });
});
