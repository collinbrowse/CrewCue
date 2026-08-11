import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { setRaceRoomStatusForTests } from "./raceRooms.js";

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
      athleteId: "owner-user",
      name: "Completed Room",
      creatorRole: "athlete"
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
      athleteId: "owner-user",
      name: "Unpaid",
      creatorRole: "athlete"
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

test("returns 403 when crew member is not the race athlete", async () => {
  const app = buildApp();
  await app.ready();
  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-user"));
  const roomId = await createPaidActiveRoom(app, athleteToken, "athlete-user");

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: {
      email: "crew@example.com",
      role: "crew_member"
    },
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

  const crewPing = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.7128,
      longitude: -74.006,
      recordedAt: isoNow()
    },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(crewPing.statusCode, 403);
  assert.equal(
    (crewPing.json() as { error: string }).error,
    "Only the race athlete can ingest location pings"
  );

  const historyResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/pings/history?limit=10`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(historyResponse.statusCode, 200);
  const history = historyResponse.json() as { decisions: unknown[] };
  assert.equal(history.decisions.length, 0);

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

test("rejects out-of-order and duplicate recordedAt so projection cannot regress", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createPaidActiveRoom(app, ownerToken);

  const tOlder = new Date(Date.now() - 40_000).toISOString();
  const tNewer = new Date(Date.now() - 10_000).toISOString();

  const newer = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.008,
      longitude: -70.0,
      recordedAt: tNewer
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(newer.statusCode, 201);
  const newerBody = newer.json() as {
    decision: string;
    pingId: string;
    projection?: { progressMeters: number; asOfPingId: string };
  };
  assert.equal(newerBody.decision, "accepted");
  assert.ok(newerBody.projection);
  const progressAfterNewer = newerBody.projection.progressMeters;
  assert.ok(progressAfterNewer > 0);

  const stale = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.001,
      longitude: -70.0,
      recordedAt: tOlder
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(stale.statusCode, 422);
  const staleBody = stale.json() as { decision: string; reason: string };
  assert.equal(staleBody.decision, "rejected");
  assert.equal(staleBody.reason, "stale_recorded_at");

  const duplicate = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.008,
      longitude: -70.0,
      recordedAt: tNewer
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(duplicate.statusCode, 422);
  assert.equal((duplicate.json() as { reason: string }).reason, "stale_recorded_at");

  const projection = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(projection.statusCode, 200);
  const projectionBody = projection.json() as { progressMeters: number; asOfPingId: string };
  assert.equal(projectionBody.asOfPingId, newerBody.pingId);
  assert.equal(projectionBody.progressMeters, progressAfterNewer);

  const historyResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/pings/history?limit=10`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(historyResponse.statusCode, 200);
  const history = historyResponse.json() as {
    decisions: Array<{ decision: string; reason?: string; pingId?: string }>;
  };
  assert.equal(history.decisions.length, 3);
  assert.equal(history.decisions[0]?.decision, "accepted");
  assert.equal(history.decisions[0]?.pingId, newerBody.pingId);
  assert.equal(history.decisions[1]?.decision, "rejected");
  assert.equal(history.decisions[1]?.reason, "stale_recorded_at");
  assert.equal(history.decisions[2]?.decision, "rejected");
  assert.equal(history.decisions[2]?.reason, "stale_recorded_at");

  await app.close();
});
