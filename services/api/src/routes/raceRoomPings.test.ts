import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import {
  setPingProjectionCommitDelayForTests,
  setRaceRoomStatusForTests,
  setRoomRuntimeLockWaitForTests
} from "./raceRooms.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

async function createPaidActiveRoom(
  app: ReturnType<typeof buildApp>,
  ownerToken: string,
  athleteId = "owner-user"
): Promise<string> {
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId,
      name: "Ping Test Room",
      creatorRole: "athlete"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const entitlementResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(entitlementResponse.statusCode, 200);

  const activateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 42.0, longitude: -70.0 },
          { id: "cp1", latitude: 42.01, longitude: -70.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 42.0, longitude: -70.0 },
        { latitude: 42.01, longitude: -70.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(activateResponse.statusCode, 200);

  return roomId;
}

function isoNow(): string {
  return new Date().toISOString();
}

async function addCrewMember(
  app: ReturnType<typeof buildApp>,
  roomId: string,
  athleteToken: string,
  crewToken: string
): Promise<void> {
  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(issueResponse.statusCode, 201);
  const invite = issueResponse.json() as { token: string };

  const acceptResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: invite.token },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(acceptResponse.statusCode, 200);
}

/** Fails the test instead of hanging when a gate is never reached. */
async function withinMs<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test("accepts a ping for paid active room and records history", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: isoNow(),
      horizontalAccuracyMeters: 12
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 201);
  const body = pingResponse.json() as { decision: string; pingId: string };
  assert.equal(body.decision, "accepted");
  assert.ok(body.pingId);

  const historyResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/pings/history?limit=10`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(historyResponse.statusCode, 200);
  const history = historyResponse.json() as { decisions: Array<{ decision: string }> };
  assert.equal(history.decisions.length, 1);
  assert.equal(history.decisions[0].decision, "accepted");

  await app.close();
});

test("rejects ping when room is not active", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Completed Room",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });

  await setRaceRoomStatusForTests(roomId, "completed");

  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: isoNow()
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 422);
  const body = pingResponse.json() as { decision: string; reason: string };
  assert.equal(body.decision, "rejected");
  assert.equal(body.reason, "room_not_active");

  await app.close();
});

test("rejects ping on clock skew", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: stale
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 422);
  assert.equal((pingResponse.json() as { reason: string }).reason, "clock_skew");

  await app.close();
});

test("rejects implausible motion vs last accepted ping", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const t0 = new Date(Date.now() - 30_000).toISOString();
  const first = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.0,
      longitude: -74.0,
      recordedAt: t0
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(first.statusCode, 201);

  const t1 = new Date(Date.now() - 20_000).toISOString();
  const second = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.9,
      longitude: -74.0,
      recordedAt: t1
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(second.statusCode, 422);
  assert.equal((second.json() as { reason: string }).reason, "implausible_motion");

  await app.close();
});

test("returns 402 when entitlement unpaid", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Unpaid",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: isoNow()
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 402);

  await app.close();
});

test("returns 403 for non-member", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: isoNow()
    },
    headers: {
      authorization: `Bearer ${strangerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 403);

  await app.close();
});

test("returns 400 for invalid coordinates payload", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 200,
      longitude: -74.006,
      recordedAt: isoNow()
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 400);

  await app.close();
});

test("rejects ping when horizontal accuracy is too poor", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: isoNow(),
      horizontalAccuracyMeters: 600
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(pingResponse.statusCode, 422);
  assert.equal((pingResponse.json() as { reason: string }).reason, "accuracy_too_poor");

  await app.close();
});

test("manual check-in survives a ping that already snapshotted projection state", { timeout: 15_000 }, async () => {
  const app = buildApp();
  await app.ready();
  const athleteToken = app.jwt.sign(buildClaims("athlete-checkin-ping-race"));
  const crewToken = app.jwt.sign(buildClaims("crew-checkin-ping-race"));
  const roomId = await createPaidActiveRoom(app, athleteToken, "athlete-checkin-ping-race");
  await addCrewMember(app, roomId, athleteToken, crewToken);

  let releasePingCommit: (() => void) | undefined;
  const pingCommitGate = new Promise<void>((resolve) => {
    releasePingCommit = resolve;
  });
  let markPingCommitEntered: (() => void) | undefined;
  const pingCommitEntered = new Promise<void>((resolve) => {
    markPingCommitEntered = resolve;
  });
  setPingProjectionCommitDelayForTests(roomId, async () => {
    markPingCommitEntered?.();
    await withinMs(pingCommitGate, 5_000, "ping commit release");
  });

  let markCheckInWaiting: (() => void) | undefined;
  const checkInWaiting = new Promise<void>((resolve) => {
    markCheckInWaiting = resolve;
  });
  setRoomRuntimeLockWaitForTests((waitingRoomId) => {
    if (waitingRoomId === roomId) {
      markCheckInWaiting?.();
    }
  });

  try {
    const pingResponsePromise = app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/pings`,
      payload: {
        latitude: 42.005,
        longitude: -70.0,
        recordedAt: isoNow(),
        horizontalAccuracyMeters: 8
      },
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    await withinMs(pingCommitEntered, 5_000, "athlete ping to reach projection commit");

    const checkInResponsePromise = app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/checkpoints/cp1/manual-stop`,
      payload: {
        arrivalAt: "2026-05-12T18:00:00.000Z",
        departureAt: "2026-05-12T18:10:00.000Z",
        note: "aid refill"
      },
      headers: { authorization: `Bearer ${crewToken}` }
    });
    await withinMs(checkInWaiting, 5_000, "crew check-in to queue behind the ping");
    releasePingCommit?.();

    const [pingResponse, checkInResponse] = await Promise.all([pingResponsePromise, checkInResponsePromise]);
    assert.equal(pingResponse.statusCode, 201, pingResponse.body);
    assert.equal(checkInResponse.statusCode, 200, checkInResponse.body);

    const projectionResponse = await app.inject({
      method: "GET",
      url: `/race-rooms/${roomId}/projection`,
      headers: { authorization: `Bearer ${crewToken}` }
    });
    assert.equal(projectionResponse.statusCode, 200);
    const projection = projectionResponse.json() as {
      checkpointSplits: Array<{
        checkpointId: string;
        visits: Array<{ manualEntry?: { note?: string; actualStopSeconds: number } }>;
      }>;
    };
    const aid = projection.checkpointSplits.find((row) => row.checkpointId === "cp1");
    const manual = aid?.visits.find((visit) => visit.manualEntry);
    assert.equal(
      manual?.manualEntry?.actualStopSeconds,
      600,
      "closed check-in must remain after the overlapping ping commits"
    );
  } finally {
    releasePingCommit?.();
    setPingProjectionCommitDelayForTests(roomId, undefined);
    setRoomRuntimeLockWaitForTests(undefined);
    await app.close();
  }
});
