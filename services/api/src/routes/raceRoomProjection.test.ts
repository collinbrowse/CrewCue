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

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const getBody = getResponse.json() as { asOfPingId: string; progressMeters: number };
  assert.equal(getBody.asOfPingId, pingBody.projection!.asOfPingId);
  assert.equal(getBody.progressMeters, pingBody.projection!.progressMeters);

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
