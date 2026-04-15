import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";

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
