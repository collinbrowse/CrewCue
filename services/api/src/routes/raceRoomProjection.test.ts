import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoomProjection } from "@crewcue/contracts";
import { buildApp } from "../app.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

test("returns projection after accepted ping and from GET", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Proj Room",
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
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const activateResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: {
      eventEndsAt: ends,
      course: {
        checkpoints: [
          { id: "cp0", latitude: 42.0, longitude: -70.0 },
          { id: "cp1", latitude: 42.01, longitude: -70.0 }
        ]
      },
      plannedPaceSecondsPerKm: 720
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(activateResponse.statusCode, 200);

  const recordedAt = new Date().toISOString();
  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.005,
      longitude: -70.0,
      recordedAt
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(pingResponse.statusCode, 201);
  const pingBody = pingResponse.json() as { projection?: RaceRoomProjection };
  assert.ok(pingBody.projection);
  assert.equal(pingBody.projection.roomId, roomId);
  assert.ok(pingBody.projection.progressMeters > 0);
  assert.ok(pingBody.projection.weatherStub);
  assert.equal(pingBody.projection.weatherStub?.source, "stub");
  assert.equal(pingBody.projection.projectionConfidence, "fresh");
  assert.equal(pingBody.projection.stalenessThresholdSeconds, 120);
  assert.ok(pingBody.projection.secondsSinceLastAcceptedPing >= 0);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const getBody = getResponse.json() as RaceRoomProjection;
  assert.equal(getBody.asOfPingId, pingBody.projection!.asOfPingId);
  assert.equal(getBody.progressMeters, pingBody.projection!.progressMeters);
  assert.equal(getBody.projectionConfidence, "fresh");

  await app.close();
});

test("GET projection exposes derived staleness threshold from uploadIntervalSeconds", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Interval staleness",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: {
      eventEndsAt: ends,
      course: {
        checkpoints: [
          { id: "cp0", latitude: 45.0, longitude: -67.0 },
          { id: "cp1", latitude: 45.01, longitude: -67.0 }
        ]
      }
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 45.005,
      longitude: -67.0,
      recordedAt: new Date().toISOString(),
      uploadIntervalSeconds: 40
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const body = getResponse.json() as RaceRoomProjection;
  assert.equal(body.stalenessThresholdSeconds, 100);
  assert.equal(body.projectionConfidence, "fresh");

  await app.close();
});

test("GET projection becomes degraded after silence beyond threshold", async (t) => {
  const prev = process.env.PROJECTION_STALE_AFTER_SECONDS;
  t.after(() => {
    if (prev === undefined) {
      delete process.env.PROJECTION_STALE_AFTER_SECONDS;
    } else {
      process.env.PROJECTION_STALE_AFTER_SECONDS = prev;
    }
  });
  process.env.PROJECTION_STALE_AFTER_SECONDS = "1";

  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Stale proj",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: {
      eventEndsAt: ends,
      course: {
        checkpoints: [
          { id: "cp0", latitude: 43.0, longitude: -69.0 },
          { id: "cp1", latitude: 43.01, longitude: -69.0 }
        ]
      }
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const recordedAt = new Date().toISOString();
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { latitude: 43.005, longitude: -69.0, recordedAt },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  await new Promise((r) => setTimeout(r, 1100));

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const body = getResponse.json() as RaceRoomProjection;
  assert.equal(body.projectionConfidence, "degraded");
  assert.equal(body.stalenessThresholdSeconds, 1);
  assert.ok(body.secondsSinceLastAcceptedPing >= 1);

  await app.close();
});

test("GET projection returns 403 for non-member", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Members only proj",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: {
      eventEndsAt: ends,
      course: {
        checkpoints: [
          { id: "cp0", latitude: 44.0, longitude: -68.0 },
          { id: "cp1", latitude: 44.01, longitude: -68.0 }
        ]
      }
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 44.005,
      longitude: -68.0,
      recordedAt: new Date().toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${strangerToken}` }
  });
  assert.equal(getResponse.statusCode, 403);

  await app.close();
});

test("GET projection returns 404 before any accepted ping", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "No ping",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: { eventEndsAt: ends },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 404);

  await app.close();
});
