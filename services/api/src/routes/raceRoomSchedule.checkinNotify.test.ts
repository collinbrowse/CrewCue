/**
 * W2-2 (#386): closed check-in + material later ETA shift → chat push notify.
 *
 * Prefs: only `all` (default) receives; `mentions` / `none` skipped (ETA ≠ mention).
 * Threshold: ≥ 60s later-stop contribution shift. Idempotent replay must not re-notify.
 * Push failure must not fail the check-in write.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoom } from "@crewcue/contracts";
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

const AID1_PLANNED_STOPPAGE = 600;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";

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
  memberToken: string,
  role: "crew_member" | "crew_chief" = "crew_member"
) {
  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: `${memberSub}@example.com`, role },
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

async function setPref(app: TestApp, roomId: string, token: string, preference: "all" | "mentions" | "none") {
  const res = await app.inject({
    method: "POST",
    url: `/chat/rooms/${roomId}/notification-prefs`,
    payload: { preference },
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(res.statusCode, 200);
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

function closedPayload(deltaSeconds: number) {
  const actualStopSeconds = AID1_PLANNED_STOPPAGE + deltaSeconds;
  const arrivalAt = "2026-08-15T14:00:00.000Z";
  const departureAt = new Date(Date.parse(arrivalAt) + actualStopSeconds * 1000).toISOString();
  return { arrivalAt, departureAt, actualStopSeconds, deltaSeconds };
}

type CapturedDispatch = ChatPushDispatchInput;

function installCaptureTransport() {
  const captured: CapturedDispatch[] = [];
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

test("W2-2 EC1 sub-threshold / no-op overwrite → no notify", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec1"));
    const crewToken = app.jwt.sign(buildClaims("crew-w22-ec1"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC1");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w22-ec1", crewToken);
    await registerDevice(app, crewToken, "crew-w22-ec1");

    assert.ok(30 < CHECK_IN_ETA_NOTIFY_THRESHOLD_SECONDS);
    const below = closedPayload(30);
    const first = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: below.arrivalAt,
      departureAt: below.departureAt
    });
    assert.equal(first.statusCode, 200);
    assert.equal(captured.length, 0, "sub-threshold must not notify");

    // Same actual rewrite (no-op LWW) also must not notify.
    const noop = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: below.arrivalAt,
      departureAt: below.departureAt
    });
    assert.equal(noop.statusCode, 200);
    assert.equal(captured.length, 0, "no-op overwrite must not notify");
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-2 EC2 invalid check-in body → 400; no notify", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec2"));
    const crewToken = app.jwt.sign(buildClaims("crew-w22-ec2"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC2");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w22-ec2", crewToken);
    await registerDevice(app, crewToken, "crew-w22-ec2");

    const missing = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: "2026-08-15T14:00:00.000Z"
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(captured.length, 0);

    const inverted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: "2026-08-15T14:10:00.000Z",
      departureAt: "2026-08-15T14:00:00.000Z"
    });
    assert.equal(inverted.statusCode, 400);
    assert.equal(captured.length, 0);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-2 EC3 unauthorized / unpaid → 401/403/402; no notify", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec3"));
    const outsiderToken = app.jwt.sign(buildClaims("outsider-w22-ec3"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC3");
    await put50kCourse(app, roomId, ownerToken);
    const payload = closedPayload(120);

    const unauth = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/checkpoints/aid-1/manual-stop`,
      payload: { arrivalAt: payload.arrivalAt, departureAt: payload.departureAt }
    });
    assert.equal(unauth.statusCode, 401);

    const forbidden = await postManualStop(app, roomId, "aid-1", outsiderToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(forbidden.statusCode, 403);

    const unpay = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: "unpaid" },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(unpay.statusCode, 200);
    const unpaid = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(unpaid.statusCode, 402);
    assert.equal(captured.length, 0);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-2 EC4 push dispatch failure → check-in still 200", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  setChatPushTransport(async () => {
    throw new Error("simulated_push_provider_down");
  });
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec4"));
    const crewToken = app.jwt.sign(buildClaims("crew-w22-ec4"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC4");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w22-ec4", crewToken);
    await registerDevice(app, crewToken, "crew-w22-ec4");

    const payload = closedPayload(120);
    const posted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(posted.statusCode, 200);
    assert.ok((posted.json() as { checkpointSplit?: unknown }).checkpointSplit);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-2 EC5 idempotent replay → no duplicate notify", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec5"));
    const crewToken = app.jwt.sign(buildClaims("crew-w22-ec5"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC5");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w22-ec5", crewToken);
    await registerDevice(app, crewToken, "crew-w22-ec5");

    const payload = closedPayload(180);
    const idemHeaders = { "idempotency-key": "w22-manual-stop-aid1" };
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
    assert.equal(captured.length, 1, "idempotent replay must not re-dispatch");
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-2 EC6/EC8 material mid-course shift notifies with checkpoint + direction", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec68"));
    const crewToken = app.jwt.sign(buildClaims("crew-w22-ec68"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC6/8");
    const room = await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-w22-ec68", crewToken);
    await registerDevice(app, crewToken, "crew-w22-ec68");

    const payload = closedPayload(120);
    const posted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(posted.statusCode, 200);
    assert.equal(captured.length, 1);
    const dispatch = captured[0]!;
    assert.equal(dispatch.roomId, roomId);
    assert.equal(dispatch.channelId, `crew-${roomId}`);
    assert.equal(dispatch.targets.length, 1);
    assert.equal(dispatch.targets[0]?.userId, "crew-w22-ec68");
    assert.ok(dispatch.targets.every((t) => t.userId !== "owner-w22-ec68"));

    const aidTitle = room.course?.checkpoints.find((cp) => cp.id === "aid-1")?.title ?? "aid-1";
    const expectedPreview = formatCheckInEtaNotifyPreview({
      checkpointId: "aid-1",
      checkpointLabel: aidTitle,
      signedShiftSeconds: 120,
      maxAbsShiftSeconds: 120,
      direction: "late"
    });
    assert.equal(dispatch.previewText, expectedPreview);
    assert.match(dispatch.previewText ?? "", /late/);
    assert.match(dispatch.previewText ?? "", /2 min|120 sec/);
    assert.ok(!(dispatch.previewText ?? "").toLowerCase().includes("token"));
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});

test("W2-2 EC7 prefs none / mentions skip; all receives", async () => {
  _resetChatPersistenceForTests();
  resetChatPushTransport();
  const captured = installCaptureTransport();
  const app = buildApp();
  await app.ready();
  try {
    const ownerToken = app.jwt.sign(buildClaims("owner-w22-ec7"));
    const allToken = app.jwt.sign(buildClaims("crew-all-w22"));
    const mentionsToken = app.jwt.sign(buildClaims("crew-mentions-w22"));
    const noneToken = app.jwt.sign(buildClaims("crew-none-w22"));
    const roomId = await createPaidRoom(app, ownerToken, "W2-2 EC7");
    await put50kCourse(app, roomId, ownerToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-all-w22", allToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-mentions-w22", mentionsToken);
    await inviteAndAccept(app, roomId, ownerToken, "crew-none-w22", noneToken);
    await setPref(app, roomId, allToken, "all");
    await setPref(app, roomId, mentionsToken, "mentions");
    await setPref(app, roomId, noneToken, "none");
    await registerDevice(app, allToken, "crew-all-w22");
    await registerDevice(app, mentionsToken, "crew-mentions-w22");
    await registerDevice(app, noneToken, "crew-none-w22");

    const payload = closedPayload(90);
    const posted = await postManualStop(app, roomId, "aid-1", ownerToken, {
      arrivalAt: payload.arrivalAt,
      departureAt: payload.departureAt
    });
    assert.equal(posted.statusCode, 200);
    assert.equal(captured.length, 1);
    const userIds = captured[0]!.targets.map((t) => t.userId).sort();
    assert.deepEqual(userIds, ["crew-all-w22"]);
  } finally {
    resetChatPushTransport();
    await app.close();
  }
});
