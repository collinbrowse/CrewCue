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

test("issues and accepts invite with role assignment", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const inviteeToken = app.jwt.sign(buildClaims("invitee-user"));

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
  const room = createResponse.json() as { id: string };

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites`,
    payload: {
      email: "crew@example.com",
      role: "crew_member"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(issueResponse.statusCode, 201);
  const invite = issueResponse.json() as { token: string };

  const acceptResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites/accept`,
    payload: {
      token: invite.token
    },
    headers: {
      authorization: `Bearer ${inviteeToken}`
    }
  });
  assert.equal(acceptResponse.statusCode, 200);
  const accepted = acceptResponse.json() as { assignedRole: string };
  assert.equal(accepted.assignedRole, "crew_member");

  const entitlementResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/entitlement`,
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
    url: `/race-rooms/${room.id}`,
    headers: {
      authorization: `Bearer ${inviteeToken}`
    }
  });
  assert.equal(getResponse.statusCode, 200);

  await app.close();
});

test("rejects invalid invite token", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const inviteeToken = app.jwt.sign(buildClaims("invitee-user"));

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
  const room = createResponse.json() as { id: string };

  const acceptResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites/accept`,
    payload: {
      token: "invalid-token"
    },
    headers: {
      authorization: `Bearer ${inviteeToken}`
    }
  });
  assert.equal(acceptResponse.statusCode, 404);

  await app.close();
});

test("rejects expired invite token", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const inviteeToken = app.jwt.sign(buildClaims("invitee-user"));

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
  const room = createResponse.json() as { id: string };

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites`,
    payload: {
      email: "crew@example.com",
      role: "crew_member",
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  const invite = issueResponse.json() as { token: string };

  const acceptResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites/accept`,
    payload: {
      token: invite.token
    },
    headers: {
      authorization: `Bearer ${inviteeToken}`
    }
  });
  assert.equal(acceptResponse.statusCode, 410);

  await app.close();
});

test("updates room course for shared GPX usage", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
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
  const room = createResponse.json() as { id: string };

  const updateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${room.id}/course`,
    payload: {
      plannedPaceSecondsPerKm: 360,
      course: {
        checkpoints: [
          { id: "aid-1", latitude: 40.7128, longitude: -74.006, plannedStopSeconds: 120 },
          { id: "aid-2", latitude: 40.7228, longitude: -73.996, plannedStopSeconds: 120 }
        ],
        baselineTrack: {
          points: [
            { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
            { distanceMetersFromStart: 1500, referenceElapsedSeconds: 540 }
          ]
        }
      }
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });

  assert.equal(updateResponse.statusCode, 200);
  const updated = updateResponse.json() as { course: { checkpoints: Array<{ id: string }> } };
  assert.equal(updated.course.checkpoints.length, 2);
  assert.equal(updated.course.checkpoints[0]?.id, "aid-1");

  await app.close();
});
