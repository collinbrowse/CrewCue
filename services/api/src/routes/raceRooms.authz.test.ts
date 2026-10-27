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

test("returns 401 when authorization is missing or JWT is invalid", async () => {
  const app = buildApp();
  await app.ready();

  const noAuthCreate = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Race Room",
      creatorRole: "team_manager"
    }
  });
  assert.equal(noAuthCreate.statusCode, 401);

  const badJwtCreate = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Race Room",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: "Bearer not-a-real-jwt"
    }
  });
  assert.equal(badJwtCreate.statusCode, 401);

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
  const roomId = (createResponse.json() as { id: string }).id;

  const malformedClaimsToken = app.jwt.sign({
    sub: "claims-user"
    // missing teamIds / roomRoles → identity mapping fails
  } as Record<string, unknown>);

  const getWithMalformedClaims = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: {
      authorization: `Bearer ${malformedClaimsToken}`
    }
  });
  assert.equal(getWithMalformedClaims.statusCode, 401);

  await app.close();
});

test("returns 403 when caller is not a room member", async () => {
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
      name: "Race Room",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  const getForbidden = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: {
      authorization: `Bearer ${strangerToken}`
    }
  });
  assert.equal(getForbidden.statusCode, 403);

  const activateForbidden = await app.inject({
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
      authorization: `Bearer ${strangerToken}`
    }
  });
  assert.equal(activateForbidden.statusCode, 403);

  const inviteForbidden = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: {
      email: "friend@example.com",
      role: "crew_member"
    },
    headers: {
      authorization: `Bearer ${strangerToken}`
    }
  });
  assert.equal(inviteForbidden.statusCode, 403);

  const entitlementForbidden = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: {
      status: "paid"
    },
    headers: {
      authorization: `Bearer ${strangerToken}`
    }
  });
  assert.equal(entitlementForbidden.statusCode, 403);

  await app.close();
});

test("returns 403 when crew_member lacks privileged actions", async () => {
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Race Room",
      creatorRole: "athlete"
    },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: {
      email: "crew@example.com",
      role: "crew_member"
    },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(issueResponse.statusCode, 201);
  const invite = issueResponse.json() as { token: string };

  const acceptResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: {
      token: invite.token
    },
    headers: {
      authorization: `Bearer ${crewToken}`
    }
  });
  assert.equal(acceptResponse.statusCode, 200);

  const activateDenied = await app.inject({
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
      authorization: `Bearer ${crewToken}`
    }
  });
  assert.equal(activateDenied.statusCode, 403);
  assert.equal((activateDenied.json() as { error: string }).error, "Insufficient permissions");

  const issueDenied = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: {
      email: "another@example.com",
      role: "crew_member"
    },
    headers: {
      authorization: `Bearer ${crewToken}`
    }
  });
  assert.equal(issueDenied.statusCode, 403);
  assert.equal((issueDenied.json() as { error: string }).error, "Insufficient permissions");

  await app.close();
});

test("returns 403 when crew_member cannot update entitlement", async () => {
  const app = buildApp();
  await app.ready();

  const managerToken = app.jwt.sign(buildClaims("manager-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-entitlement-user"));

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
      authorization: `Bearer ${managerToken}`
    }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: {
      email: "crew-entitlement@example.com",
      role: "crew_member"
    },
    headers: {
      authorization: `Bearer ${managerToken}`
    }
  });
  assert.equal(issueResponse.statusCode, 201);
  const invite = issueResponse.json() as { token: string };

  const acceptResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: {
      token: invite.token
    },
    headers: {
      authorization: `Bearer ${crewToken}`
    }
  });
  assert.equal(acceptResponse.statusCode, 200);

  const entitlementDenied = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: {
      status: "paid"
    },
    headers: {
      authorization: `Bearer ${crewToken}`
    }
  });
  assert.equal(entitlementDenied.statusCode, 403);
  assert.equal((entitlementDenied.json() as { error: string }).error, "Insufficient permissions");

  await app.close();
});

test("crew member cannot read another invite token from the room list", async () => {
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "Race Room",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const crewInvite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(crewInvite.statusCode, 201);
  const crewTokenValue = (crewInvite.json() as { token: string }).token;

  const acceptCrew = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: crewTokenValue },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(acceptCrew.statusCode, 200);

  const chiefInvite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "chief@example.com", role: "crew_chief" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(chiefInvite.statusCode, 201);
  const chiefTokenValue = (chiefInvite.json() as { token: string }).token;

  const crewList = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(crewList.statusCode, 200);
  const crewInvites = (crewList.json() as { invites: Array<Record<string, unknown>> }).invites;
  const listedChief = crewInvites.find((invite) => invite.email === "chief@example.com");
  assert.ok(listedChief);
  assert.equal(listedChief.role, "crew_chief");
  assert.equal(Object.hasOwn(listedChief, "token"), false);

  const athleteList = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/invites`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(athleteList.statusCode, 200);
  const athleteInvites = (athleteList.json() as { invites: Array<{ email: string; token?: string }> }).invites;
  assert.equal(athleteInvites.find((invite) => invite.email === "chief@example.com")?.token, chiefTokenValue);

  await app.close();
});

test("accepting a crew invite does not demote the race athlete", async () => {
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "Race Room",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const inviteResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(inviteResponse.statusCode, 201);
  const token = (inviteResponse.json() as { token: string }).token;

  const selfAccept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(selfAccept.statusCode, 409);
  assert.equal(
    (selfAccept.json() as { error: string }).error,
    "Race owner role cannot be changed from athlete"
  );

  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(paid.statusCode, 200);

  const roomAfter = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(roomAfter.statusCode, 200);
  const viewed = roomAfter.json() as {
    permissions: { canEditRaceSetup: boolean };
    room: { memberships: Array<{ userId: string; role: string }> };
  };
  assert.equal(viewed.room.memberships.find((member) => member.userId === "athlete-user")?.role, "athlete");
  assert.equal(viewed.permissions.canEditRaceSetup, true);

  const crewAccept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(crewAccept.statusCode, 200);
  assert.equal((crewAccept.json() as { assignedRole: string }).assignedRole, "crew_member");

  await app.close();
});
