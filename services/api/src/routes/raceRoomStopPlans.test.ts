import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";
import type { RaceCourseCheckpoint, RaceRoom, RaceRoomStopPlan, StopPlanNote } from "@crewcue/contracts";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

type TestApp = ReturnType<typeof buildApp>;

function checkpointById(room: RaceRoom, id: string): RaceCourseCheckpoint {
  const checkpoint = room.course?.checkpoints.find((row) => row.id === id);
  assert.ok(checkpoint, `missing checkpoint ${id}`);
  return checkpoint;
}

function geometryFingerprint(checkpoint: RaceCourseCheckpoint) {
  return {
    latitude: checkpoint.latitude,
    longitude: checkpoint.longitude,
    distanceMetersFromStart: checkpoint.distanceMetersFromStart,
    plannedStopSeconds: checkpoint.plannedStopSeconds,
    tags: checkpoint.tags,
    title: checkpoint.title
  };
}

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

async function getRoom(app: TestApp, roomId: string, token: string): Promise<RaceRoom> {
  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(getResponse.statusCode, 200);
  return (getResponse.json() as { room: RaceRoom }).room;
}

async function getStopPlans(app: TestApp, roomId: string, token: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/stop-plans`,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function getStopPlan(app: TestApp, roomId: string, checkpointId: string, token: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/stop-plans/${checkpointId}`,
    headers: { authorization: `Bearer ${token}` }
  });
}

async function putStopPlan(
  app: TestApp,
  roomId: string,
  checkpointId: string,
  token: string,
  payload: object | string,
  extraHeaders: Record<string, string> = {}
) {
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/stop-plans/${checkpointId}`,
    payload,
    headers: { authorization: `Bearer ${token}`, ...extraHeaders }
  });
}

type StopPlanBody = {
  roomId: string;
  checkpointId: string;
  delayOverrideSeconds?: number;
  athleteNotes?: StopPlanNote;
  planNotes?: StopPlanNote;
};

test("EC1 omitted optional notes/delay leave overlay empty and waypoint unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec1"));
  const roomId = await createPaidRoom(app, ownerToken, "EC1 omitted overlay");
  const seeded = await put50kCourse(app, roomId, ownerToken);
  assert.deepEqual(
    seeded.course?.checkpoints.map((checkpoint) => checkpoint.id),
    [...GOLDEN_CHECKPOINT_IDS]
  );
  const beforeAid2 = geometryFingerprint(checkpointById(seeded, "aid-2"));

  const listBefore = await getStopPlans(app, roomId, ownerToken);
  assert.equal(listBefore.statusCode, 200);
  assert.deepEqual(listBefore.json(), { roomId, stopPlans: [] });

  const getBefore = await getStopPlan(app, roomId, "aid-2", ownerToken);
  assert.equal(getBefore.statusCode, 200);
  assert.deepEqual(getBefore.json(), { roomId, checkpointId: "aid-2" });

  const putEmpty = await putStopPlan(app, roomId, "aid-2", ownerToken, {});
  assert.equal(putEmpty.statusCode, 200);
  assert.deepEqual(putEmpty.json(), { roomId, checkpointId: "aid-2" });

  const getAfter = await getStopPlan(app, roomId, "aid-2", ownerToken);
  assert.equal(getAfter.statusCode, 200);
  assert.deepEqual(getAfter.json(), { roomId, checkpointId: "aid-2" });
  assert.equal((getAfter.json() as StopPlanBody).delayOverrideSeconds, undefined);
  assert.equal((getAfter.json() as StopPlanBody).athleteNotes, undefined);
  assert.equal((getAfter.json() as StopPlanBody).planNotes, undefined);

  const roomAfter = await getRoom(app, roomId, ownerToken);
  assert.equal(roomAfter.stopPlans, undefined);
  assert.deepEqual(geometryFingerprint(checkpointById(roomAfter, "aid-2")), beforeAid2);
  assert.equal("athleteNotes" in (checkpointById(roomAfter, "aid-2") as object), false);

  await app.close();
});

test("EC2 invalid delay returns 400 and leaves persisted overlay unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec2"));
  const roomId = await createPaidRoom(app, ownerToken, "EC2 invalid delay");
  await put50kCourse(app, roomId, ownerToken);

  const seeded = await putStopPlan(app, roomId, "aid-2", ownerToken, {
    delayOverrideSeconds: 120,
    planNotes: { id: "note-plan-aid-2", body: "Crew at mile 20" }
  });
  assert.equal(seeded.statusCode, 200);
  const before = seeded.json() as StopPlanBody;

  for (const invalid of [-1, "120", true, { seconds: 120 }]) {
    const denied = await putStopPlan(app, roomId, "aid-2", ownerToken, { delayOverrideSeconds: invalid });
    assert.equal(denied.statusCode, 400, `expected 400 for ${String(invalid)}`);
  }

  const extraField = await putStopPlan(app, roomId, "aid-2", ownerToken, {
    delayOverrideSeconds: 999,
    unexpected: true
  });
  assert.equal(extraField.statusCode, 400);

  const corrupt = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/stop-plans/aid-2`,
    headers: {
      authorization: `Bearer ${ownerToken}`,
      "content-type": "application/json"
    },
    payload: '{"delayOverrideSeconds":'
  });
  assert.equal(corrupt.statusCode, 400);

  const after = await getStopPlan(app, roomId, "aid-2", ownerToken);
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json(), before);
  assert.equal((after.json() as StopPlanBody).delayOverrideSeconds, 120);

  const room = await getRoom(app, roomId, ownerToken);
  assert.equal(checkpointById(room, "aid-2").plannedStopSeconds, checkpointById(room, "aid-2").plannedStopSeconds);

  await app.close();
});

test("EC3 unauthorized, crew_member, and unpaid callers cannot write; members can read", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec3"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-w12-ec3"));
  const crewToken = app.jwt.sign(buildClaims("crew-w12-ec3"));
  const roomId = await createPaidRoom(app, ownerToken, "EC3 authz overlay");
  await put50kCourse(app, roomId, ownerToken);

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

  const payload = { delayOverrideSeconds: 90, athleteNotes: { body: "should not persist" } };

  const unauthPut = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/stop-plans/aid-1`,
    payload
  });
  assert.equal(unauthPut.statusCode, 401);

  const strangerPut = await putStopPlan(app, roomId, "aid-1", strangerToken, payload);
  assert.equal(strangerPut.statusCode, 403);

  const crewPut = await putStopPlan(app, roomId, "aid-1", crewToken, payload);
  assert.equal(crewPut.statusCode, 403);
  const crewPatch = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/stop-plans/aid-1`,
    payload,
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(crewPatch.statusCode, 403);
  const crewDelete = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/stop-plans/aid-1`,
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(crewDelete.statusCode, 403);

  const afterDenied = await getStopPlan(app, roomId, "aid-1", ownerToken);
  assert.equal(afterDenied.statusCode, 200);
  assert.deepEqual(afterDenied.json(), { roomId, checkpointId: "aid-1" });

  const ownerPut = await putStopPlan(app, roomId, "aid-1", ownerToken, { delayOverrideSeconds: 45 });
  assert.equal(ownerPut.statusCode, 200);

  const crewRead = await getStopPlan(app, roomId, "aid-1", crewToken);
  assert.equal(crewRead.statusCode, 200);
  assert.equal((crewRead.json() as StopPlanBody).delayOverrideSeconds, 45);

  const unpay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "unpaid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(unpay.statusCode, 200);
  const unpaidWrite = await putStopPlan(app, roomId, "aid-1", ownerToken, { delayOverrideSeconds: 999 });
  assert.equal(unpaidWrite.statusCode, 402);
  assert.equal((unpaidWrite.json() as { error: string }).error, "Entitlement unpaid");

  const repay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(repay.statusCode, 200);
  const afterUnpaid = await getStopPlan(app, roomId, "aid-1", ownerToken);
  assert.equal(afterUnpaid.statusCode, 200);
  assert.equal((afterUnpaid.json() as StopPlanBody).delayOverrideSeconds, 45);

  await app.close();
});

test("EC4 idempotent write replay returns the stored overlay response", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec4"));
  const roomId = await createPaidRoom(app, ownerToken, "EC4 idempotent overlay");
  await put50kCourse(app, roomId, ownerToken);
  const headers = { "idempotency-key": "w12-stop-plan-replay" };
  const payload = {
    delayOverrideSeconds: 120,
    planNotes: { id: "note-plan-aid-2", body: "Drop bag left side" }
  };

  const first = await putStopPlan(app, roomId, "aid-2", ownerToken, payload, headers);
  assert.equal(first.statusCode, 200);
  const firstBody = first.json() as StopPlanBody;
  assert.equal(firstBody.delayOverrideSeconds, 120);
  assert.equal(firstBody.planNotes?.id, "note-plan-aid-2");

  const replay = await putStopPlan(app, roomId, "aid-2", ownerToken, payload, headers);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());

  const after = await getStopPlan(app, roomId, "aid-2", ownerToken);
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json(), firstBody);

  await app.close();
});

test("EC5 duplicate upsert is idempotent with stable note ids and room-scoped overlays", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec5"));
  const roomA = await createPaidRoom(app, ownerToken, "EC5 room A");
  const roomB = await createPaidRoom(app, ownerToken, "EC5 room B");
  await put50kCourse(app, roomA, ownerToken);
  await put50kCourse(app, roomB, ownerToken);

  const payload = {
    delayOverrideSeconds: 60,
    athleteNotes: { body: "Walk the hill" },
    planNotes: { id: "note-plan-aid-3", body: "Crew car at lot B" }
  };

  const first = await putStopPlan(app, roomA, "aid-3", ownerToken, payload);
  assert.equal(first.statusCode, 200);
  const firstBody = first.json() as StopPlanBody;
  assert.equal(typeof firstBody.athleteNotes?.id, "string");
  assert.ok((firstBody.athleteNotes?.id ?? "").length > 0);
  assert.equal(firstBody.planNotes?.id, "note-plan-aid-3");

  const second = await putStopPlan(app, roomA, "aid-3", ownerToken, payload);
  assert.equal(second.statusCode, 200);
  const secondBody = second.json() as StopPlanBody;
  assert.equal(secondBody.athleteNotes?.id, firstBody.athleteNotes?.id);
  assert.equal(secondBody.planNotes?.id, "note-plan-aid-3");
  assert.deepEqual(secondBody, firstBody);

  const after = await getStopPlan(app, roomA, "aid-3", ownerToken);
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json(), firstBody);

  const roomBGet = await getStopPlan(app, roomB, "aid-3", ownerToken);
  assert.equal(roomBGet.statusCode, 200);
  assert.deepEqual(roomBGet.json(), { roomId: roomB, checkpointId: "aid-3" });

  const listA = await getStopPlans(app, roomA, ownerToken);
  const listB = await getStopPlans(app, roomB, ownerToken);
  assert.equal((listA.json() as { stopPlans: RaceRoomStopPlan[] }).stopPlans.length, 1);
  assert.deepEqual((listB.json() as { stopPlans: RaceRoomStopPlan[] }).stopPlans, []);

  await app.close();
});

test("EC6 delay is extra seconds and notes have no timezone fields", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec6"));
  const roomId = await createPaidRoom(app, ownerToken, "EC6 seconds");
  const seeded = await put50kCourse(app, roomId, ownerToken);
  const beforeAid2 = geometryFingerprint(checkpointById(seeded, "aid-2"));
  const plannedBefore = checkpointById(seeded, "aid-2").plannedStopSeconds;

  const put = await putStopPlan(app, roomId, "aid-2", ownerToken, {
    delayOverrideSeconds: 120,
    planNotes: { id: "note-plan-aid-2", body: "Extra 2 minutes for drop bag" }
  });
  assert.equal(put.statusCode, 200);
  const body = put.json() as StopPlanBody;
  assert.equal(body.delayOverrideSeconds, 120);
  assert.equal(typeof body.delayOverrideSeconds, "number");
  assert.equal("timezone" in (body.planNotes as object), false);
  assert.equal("clockArrivalAt" in body, false);

  const after = await getStopPlan(app, roomId, "aid-2", ownerToken);
  assert.equal(after.statusCode, 200);
  assert.equal((after.json() as StopPlanBody).delayOverrideSeconds, 120);

  const room = await getRoom(app, roomId, ownerToken);
  const aid2 = checkpointById(room, "aid-2");
  assert.equal(aid2.plannedStopSeconds, plannedBefore);
  assert.deepEqual(geometryFingerprint(aid2), beforeAid2);
  assert.equal("delayOverrideSeconds" in aid2, false);

  const patchTitle = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/aid-2`,
    payload: { title: "Aid 2" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(patchTitle.statusCode, 200);
  const afterTitle = await getStopPlan(app, roomId, "aid-2", ownerToken);
  assert.equal((afterTitle.json() as StopPlanBody).delayOverrideSeconds, 120);
  const roomAfterTitle = await getRoom(app, roomId, ownerToken);
  assert.equal(checkpointById(roomAfterTitle, "aid-2").plannedStopSeconds, plannedBefore);
  assert.equal(checkpointById(roomAfterTitle, "aid-2").latitude, beforeAid2.latitude);

  await app.close();
});

test("EC7 unknown checkpoint or room returns 404 and creates no overlay row", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec7"));
  const roomId = await createPaidRoom(app, ownerToken, "EC7 missing checkpoint");
  await put50kCourse(app, roomId, ownerToken);

  const missingCp = await putStopPlan(app, roomId, "not-a-checkpoint", ownerToken, {
    delayOverrideSeconds: 30,
    athleteNotes: { id: "note-athlete-missing", body: "should not persist" }
  });
  assert.equal(missingCp.statusCode, 404);

  const getMissing = await getStopPlan(app, roomId, "not-a-checkpoint", ownerToken);
  assert.equal(getMissing.statusCode, 404);

  const list = await getStopPlans(app, roomId, ownerToken);
  assert.equal(list.statusCode, 200);
  assert.deepEqual((list.json() as { stopPlans: RaceRoomStopPlan[] }).stopPlans, []);

  const room = await getRoom(app, roomId, ownerToken);
  assert.equal(room.stopPlans, undefined);
  assert.equal(room.course?.checkpoints.some((checkpoint) => checkpoint.id === "not-a-checkpoint"), false);

  const missingRoomPut = await putStopPlan(app, "missing-room", "aid-1", ownerToken, { delayOverrideSeconds: 10 });
  assert.equal(missingRoomPut.statusCode, 404);
  const missingRoomGet = await getStopPlans(app, "missing-room", ownerToken);
  assert.equal(missingRoomGet.statusCode, 404);

  await app.close();
});

test("EC8 clearing delay/notes removes the overlay and keeps the waypoint", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w12-ec8"));
  const roomId = await createPaidRoom(app, ownerToken, "EC8 clear overlay");
  const seeded = await put50kCourse(app, roomId, ownerToken);
  const beforeAid1 = geometryFingerprint(checkpointById(seeded, "aid-1"));
  const beforeAid3 = geometryFingerprint(checkpointById(seeded, "aid-3"));

  const putAid1 = await putStopPlan(app, roomId, "aid-1", ownerToken, {
    delayOverrideSeconds: 15,
    athleteNotes: { id: "note-athlete-aid-1", body: "Fill bottles" }
  });
  assert.equal(putAid1.statusCode, 200);
  const putAid3 = await putStopPlan(app, roomId, "aid-3", ownerToken, {
    delayOverrideSeconds: 480,
    planNotes: { id: "note-plan-aid-3", body: "Long crew stop" },
    athleteNotes: { id: "note-athlete-aid-3", body: "Change socks" }
  });
  assert.equal(putAid3.statusCode, 200);

  const clearDelay = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/stop-plans/aid-1`,
    payload: { delayOverrideSeconds: null, athleteNotes: null },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(clearDelay.statusCode, 200);
  const afterNull = await getStopPlan(app, roomId, "aid-1", ownerToken);
  assert.equal(afterNull.statusCode, 200);
  assert.deepEqual(afterNull.json(), { roomId, checkpointId: "aid-1" });

  const emptyBodyClears = await putStopPlan(app, roomId, "aid-3", ownerToken, {
    planNotes: { id: "note-plan-aid-3", body: "   " },
    athleteNotes: { body: "" }
  });
  assert.equal(emptyBodyClears.statusCode, 200);
  assert.equal((emptyBodyClears.json() as StopPlanBody).planNotes, undefined);
  assert.equal((emptyBodyClears.json() as StopPlanBody).athleteNotes, undefined);
  assert.equal((emptyBodyClears.json() as StopPlanBody).delayOverrideSeconds, 480);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/stop-plans/aid-3`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(deleted.statusCode, 200);
  const afterDelete = await getStopPlan(app, roomId, "aid-3", ownerToken);
  assert.equal(afterDelete.statusCode, 200);
  assert.deepEqual(afterDelete.json(), { roomId, checkpointId: "aid-3" });

  const list = await getStopPlans(app, roomId, ownerToken);
  assert.deepEqual((list.json() as { stopPlans: RaceRoomStopPlan[] }).stopPlans, []);

  const room = await getRoom(app, roomId, ownerToken);
  assert.equal(room.stopPlans, undefined);
  assert.deepEqual(geometryFingerprint(checkpointById(room, "aid-1")), beforeAid1);
  assert.deepEqual(geometryFingerprint(checkpointById(room, "aid-3")), beforeAid3);
  assert.ok(room.course?.checkpoints.some((checkpoint) => checkpoint.id === "aid-1"));
  assert.ok(room.course?.checkpoints.some((checkpoint) => checkpoint.id === "aid-3"));

  await app.close();
});
