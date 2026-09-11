/**
 * W2-I (#391) integration smoke:
 * seed 50k course → closed mid-course manual-stop → GET /schedule later clocks shift
 * + material (≥60s) notify path with push mocks.
 *
 * Edge-case reuse (do not duplicate full matrices):
 * - EC1–EC3, EC5–EC6 schedule: `raceRoomSchedule.checkin.test.ts` (W2-1)
 * - EC1–EC3, EC5–EC6 notify: `raceRoomSchedule.checkinNotify.test.ts` (W2-2)
 * - EC8 DEV mobile: ios-simulator-agent-qa on `crewcue://dev/schedule-sheet` (PR evidence)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCrewScheduleSheet,
  type CrewScheduleSheet,
  type RaceRoom
} from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { _resetChatPersistenceForTests } from "../lib/chatPersistence.js";
import {
  CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS,
  formatCheckInEtaNotifyPreview
} from "../lib/checkInEtaNotify.js";
import {
  resetChatPushTransport,
  setChatPushTransport,
  type ChatPushDispatchInput
} from "../lib/chatPushDispatch.js";
import { load50kCourseWithAids } from "../lib/testCourseRouteLayer.js";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const AID1_PLANNED_STOPPAGE = 600;

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

async function inviteAndAccept(
  app: TestApp,
  roomId: string,
  ownerToken: string,
  memberSub: string,
  memberToken: string
) {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: `${memberSub}@example.com`, role: "crew_member" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(invite.statusCode, 201);
  const inviteToken = (invite.json() as { token: string }).token;
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: inviteToken },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(accept.statusCode, 200);
}

async function registerDevice(app: TestApp, token: string, userId: string) {
  const res = await app.inject({
    method: "POST",
    url: "/chat/push/tokens",
    payload: { deviceId: `dev-${userId}`, platform: "ios", token: `apns-${userId}` },
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(res.statusCode, 201);
}

async function getSchedule(app: TestApp, roomId: string, token: string) {
  return app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/schedule`,
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
      `${id} must not shift from own/prior check-in stoppage`
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
    assert.match(stopByCheckpoint(after, id).clockArrivalAt, ISO_Z);
  }
}

function closedPayload(deltaSeconds: number) {
  const actualStopSeconds = AID1_PLANNED_STOPPAGE + deltaSeconds;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();
  return { arrivalAt, departureAt, actualStopSeconds, deltaSeconds };
}

function installCaptureTransport() {
  const captured: ChatPushDispatchInput[] = [];
  setChatPushTransport(async (input) => {
    captured.push(input);
    return {
      delivered: input.targets.length,
      attempts: input.targets.length,
      failures: []
    };
  });
  return captured;
}

test("W2-I EC7+notify: mid-course closed check-in shifts later clocks and notifies crew", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w2i"));
    const crewToken = app.jwt.sign(buildClaims("crew-w2i"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-I integration");
    const room = await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w2i", crewToken);
    await registerDevice(app, crewToken, "crew-w2i");

    const baselineRes = await getSchedule(app, roomId, ownerToken);
    assert.equal(baselineRes.statusCode, 200);
    const baseline = parseCrewScheduleSheet(baselineRes.json());
    assert.equal(stopByCheckpoint(baseline, "aid-1").plannedStoppageSeconds, AID1_PLANNED_STOPPAGE);

    const deltaSeconds = 120;
    assert.ok(deltaSeconds >= CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS);
    const payload = closedPayload(deltaSeconds);

    const posted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(posted.statusCode, 200);

    const afterRes = await getSchedule(app, roomId, ownerToken);
    assert.equal(afterRes.statusCode, 200);
    const after = parseCrewScheduleSheet(afterRes.json());
    assertLaterStopsShiftedBy(baseline, after, deltaSeconds, "aid-1");

    assert.equal(captured.length, 1, "material shift must notify once");
    const dispatch = captured[0]!;
    assert.equal(dispatch.roomId, roomId);
    assert.equal(dispatch.targets.length, 1);
    assert.equal(dispatch.targets[0]?.userId, "crew-w2i");
    assert.ok(dispatch.targets.every((t) => t.userId !== "owner-w2i"));

    const aidTitle = room.course?.checkpoints.find((cp) => cp.id === "aid-1")?.title ?? "aid-1";
    assert.equal(
      dispatch.previewText,
      formatCheckInEtaNotifyPreview({
        checkpointId: "aid-1",
        checkpointLabel: aidTitle,
        signedShiftSeconds: deltaSeconds,
        maxAbsShiftSeconds: deltaSeconds,
        direction: "late"
      })
    );
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-I EC1 planned-equal actual: schedule unchanged; no material notify", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w2i-ec1"));
    const crewToken = app.jwt.sign(buildClaims("crew-w2i-ec1"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-I EC1");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w2i-ec1", crewToken);
    await registerDevice(app, crewToken, "crew-w2i-ec1");

    const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    const payload = closedPayload(0);
    const posted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(posted.statusCode, 200);

    const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.deepEqual(after.stops, baseline.stops);
    assert.equal(captured.length, 0);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-I EC4 push failure: check-in 200 and schedule still shifts", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  setChatPushTransport(async () => {
    throw new Error("simulated_push_provider_down");
  });
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w2i-ec4"));
    const crewToken = app.jwt.sign(buildClaims("crew-w2i-ec4"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-I EC4");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w2i-ec4", crewToken);
    await registerDevice(app, crewToken, "crew-w2i-ec4");

    const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    const payload = closedPayload(180);
    const posted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(posted.statusCode, 200);

    const after = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assertLaterStopsShiftedBy(baseline, after, payload.deltaSeconds, "aid-1");
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-I EC5 idempotent replay: no double-shift and no duplicate notify", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w2i-ec5"));
    const crewToken = app.jwt.sign(buildClaims("crew-w2i-ec5"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-I EC5");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w2i-ec5", crewToken);
    await registerDevice(app, crewToken, "crew-w2i-ec5");

    const baseline = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    const payload = closedPayload(120);
    const idemHeaders = { "idempotency-key": "w2i-manual-stop-aid1" };

    const first = await postManualStop(
      app,
      roomId,
      "aid-1",
      ownerToken,
      { arrivalAt: payload.arrivalAt, departureAt: payload.departureAt },
      idemHeaders
    );
    assert.equal(first.statusCode, 200);
    assert.equal(captured.length, 1);

    const afterFirst = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assertLaterStopsShiftedBy(baseline, afterFirst, payload.deltaSeconds, "aid-1");

    const replay = await postManualStop(
      app,
      roomId,
      "aid-1",
      ownerToken,
      { arrivalAt: payload.arrivalAt, departureAt: payload.departureAt },
      idemHeaders
    );
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), first.json());
    assert.equal(captured.length, 1, "idempotent replay must not re-notify");

    const afterReplay = parseCrewScheduleSheet((await getSchedule(app, roomId, ownerToken)).json());
    assert.deepEqual(afterReplay.stops, afterFirst.stops);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});
