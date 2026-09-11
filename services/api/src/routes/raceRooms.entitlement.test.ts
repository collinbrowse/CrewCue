import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

async function createRoomWithOwner(app: ReturnType<typeof buildApp>, ownerToken: string): Promise<string> {
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Race Room",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  return (createResponse.json() as { id: string }).id;
}

test("blocks room access when entitlement is unpaid", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createRoomWithOwner(app, ownerToken);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });

  assert.equal(getResponse.statusCode, 402);
  assert.equal((getResponse.json() as { error: string }).error, "Entitlement unpaid");
  await app.close();
});

test("blocks course and map workspace routes when entitlement is unpaid", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createRoomWithOwner(app, ownerToken);
  const routeOverlayLayer = lineStringRouteOverlayForCheckpoints([
    { latitude: 42.0, longitude: -70.0 },
    { latitude: 42.01, longitude: -70.0 }
  ]);
  const headers = { authorization: `Bearer ${ownerToken}` };

  const courseResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 42.0, longitude: -70.0 },
          { id: "cp1", latitude: 42.01, longitude: -70.0 }
        ]
      },
      routeOverlayLayer,
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers
  });
  assert.equal(courseResponse.statusCode, 402);
  assert.equal((courseResponse.json() as { error: string }).error, "Entitlement unpaid");

  const getMapResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/map-workspace`,
    headers
  });
  assert.equal(getMapResponse.statusCode, 402);
  assert.equal((getMapResponse.json() as { error: string }).error, "Entitlement unpaid");

  const putMapResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/map-workspace`,
    payload: {
      layers: [routeOverlayLayer],
      selectedLayerId: routeOverlayLayer.id,
      drivesProjectionLayerId: routeOverlayLayer.id,
      checkpoints: [
        { id: "cp0", latitude: 42.0, longitude: -70.0 },
        { id: "cp1", latitude: 42.01, longitude: -70.0 }
      ]
    },
    headers
  });
  assert.equal(putMapResponse.statusCode, 402);
  assert.equal((putMapResponse.json() as { error: string }).error, "Entitlement unpaid");

  const postCheckpoint = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints`,
    payload: { id: "cp2", latitude: 42.02, longitude: -70.0, tags: ["aid"] },
    headers
  });
  assert.equal(postCheckpoint.statusCode, 402);

  const patchCheckpoint = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/cp0`,
    payload: { tags: ["crew"] },
    headers
  });
  assert.equal(patchCheckpoint.statusCode, 402);

  const deleteCheckpoint = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/cp0`,
    headers
  });
  assert.equal(deleteCheckpoint.statusCode, 402);

  await app.close();
});

test("allows access after entitlement status becomes paid", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createRoomWithOwner(app, ownerToken);

  const entitlementResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: {
      status: "paid"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(entitlementResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });

  assert.equal(getResponse.statusCode, 200);
  await app.close();
});

test("returns explicit expired error for room access", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const roomId = await createRoomWithOwner(app, ownerToken);

  const entitlementResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: {
      status: "expired"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(entitlementResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });

  assert.equal(getResponse.statusCode, 403);
  assert.equal((getResponse.json() as { error: string }).error, "Entitlement expired");
  await app.close();
});
