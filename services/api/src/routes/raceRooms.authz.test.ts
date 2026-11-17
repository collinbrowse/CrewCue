import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

/** Crew invites and accepts need a paid race (402 `room_unpaid`). Same grant path as a store purchase. */
async function payForRoom(app: ReturnType<typeof buildApp>, roomId: string, memberToken: string): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/billing/dev-purchase`,
    payload: { productId: "race_pass" },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(response.statusCode, 200);
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

  // A fresh owner: the race stays unpaid, and Postgres runs share one database (unpaid race limit).
  const ownerToken = app.jwt.sign(buildClaims(`owner-user-${randomUUID()}`));
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

  // A fresh owner: the race stays unpaid, and Postgres runs share one database (unpaid race limit).
  const ownerToken = app.jwt.sign(buildClaims(`owner-user-${randomUUID()}`));
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
  await payForRoom(app, roomId, athleteToken);

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
  await payForRoom(app, roomId, managerToken);

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
  // Crew plus a crew chief needs the Full Crew tier (#649).
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid", crewTier: "unlimited" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(paid.statusCode, 200);

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
  // Crew are invited only to a paid race.
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(paid.statusCode, 200);

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

test("only the race owner can issue invites above crew_member", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("athlete-user"));
  const chiefToken = app.jwt.sign(buildClaims("chief-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "athlete-user", name: "Race Room", creatorRole: "athlete" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;
  // Crew plus a crew chief needs the Full Crew tier (#649).
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid", crewTier: "unlimited" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(paid.statusCode, 200);

  const chiefInvite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "chief@example.com", role: "crew_chief" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(chiefInvite.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (chiefInvite.json() as { token: string }).token },
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(accept.statusCode, 200);

  for (const role of ["team_manager", "athlete", "crew_chief"]) {
    const escalated = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites`,
      payload: { email: `${role}@example.com`, role },
      headers: { authorization: `Bearer ${chiefToken}` }
    });
    assert.equal(escalated.statusCode, 403, `crew_chief must not invite ${role}`);
  }

  const crewInvite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(crewInvite.statusCode, 201);

  await app.close();
});

test("two roles: a crew_member edits course details but not race setup", async () => {
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(buildClaims("athlete-two-roles"));
  const crewToken = app.jwt.sign(buildClaims("crew-two-roles"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-two-roles"));
  const athleteAuth = { authorization: `Bearer ${athleteToken}` };
  const crewAuth = { authorization: `Bearer ${crewToken}` };

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "athlete-1", name: "Race Room", creatorRole: "athlete" },
    headers: athleteAuth
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await payForRoom(app, roomId, athleteToken);

  const checkpoints = [
    { id: "cp0", latitude: 42.0, longitude: -70.0 },
    { id: "cp1", latitude: 42.005, longitude: -70.0 },
    { id: "cp2", latitude: 42.01, longitude: -70.0 }
  ];
  const routeOverlayLayer = lineStringRouteOverlayForCheckpoints(checkpoints);
  const coursePayload = {
    course: { checkpoints },
    routeOverlayLayer,
    plannedPaceSecondsPerKm: 720,
    raceStartAt: "2030-05-12T16:00:00.000Z"
  };
  const courseSaved = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: coursePayload,
    headers: athleteAuth
  });
  assert.equal(courseSaved.statusCode, 200, courseSaved.body);

  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: athleteAuth
  });
  assert.equal(invite.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (invite.json() as { token: string }).token },
    headers: crewAuth
  });
  assert.equal(accept.statusCode, 200);

  // The permission set a client reads says the same.
  const viewed = await app.inject({ method: "GET", url: `/race-rooms/${roomId}`, headers: crewAuth });
  const permissions = (viewed.json() as { permissions: Record<string, boolean> }).permissions;
  assert.equal(permissions.canEditCourse, true);
  assert.equal(permissions.canEditRaceSetup, false);
  assert.equal(permissions.canIssueInvite, false);

  // Course details: allowed.
  const patchedCheckpoint = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/cp1`,
    payload: { tags: ["aid"] },
    headers: crewAuth
  });
  assert.equal(patchedCheckpoint.statusCode, 200, patchedCheckpoint.body);
  const workspacePayload = {
    layers: [routeOverlayLayer],
    selectedLayerId: routeOverlayLayer.id,
    drivesProjectionLayerId: routeOverlayLayer.id,
    checkpoints
  };
  // The map workspace replaces the course and wipes race state: race setup, not a course detail.
  const workspaceRead = await app.inject({ method: "GET", url: `/race-rooms/${roomId}/map-workspace`, headers: crewAuth });
  assert.equal(workspaceRead.statusCode, 200, workspaceRead.body);
  const workspaceWrite = {
    method: "PUT" as const,
    url: `/race-rooms/${roomId}/map-workspace`,
    payload: workspacePayload
  };
  const strangerWorkspace = await app.inject({
    ...workspaceWrite,
    headers: { authorization: `Bearer ${strangerToken}` }
  });
  assert.equal(strangerWorkspace.statusCode, 403);

  // Race setup, invites and billing: still refused, with the same error.
  const refused = [
    await app.inject({ ...workspaceWrite, headers: crewAuth }),
    await app.inject({ method: "PUT", url: `/race-rooms/${roomId}/course`, payload: coursePayload, headers: crewAuth }),
    await app.inject({
      method: "PATCH",
      url: `/race-rooms/${roomId}/race-start`,
      payload: { raceStartAt: "2030-05-12T17:00:00.000Z" },
      headers: crewAuth
    }),
    await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/entitlement`,
      payload: { status: "unpaid" },
      headers: crewAuth
    }),
    await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites`,
      payload: { email: "other@example.com", role: "crew_member" },
      headers: crewAuth
    })
  ];
  for (const response of refused) {
    assert.equal(response.statusCode, 403, response.body);
    assert.equal((response.json() as { error: string }).error, "Insufficient permissions");
  }

  // An unpaid race still answers crew with 402 before anything is edited.
  const unpay = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "unpaid" },
    headers: athleteAuth
  });
  assert.equal(unpay.statusCode, 200);
  const unpaid = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/cp1`,
    payload: { tags: ["water"] },
    headers: crewAuth
  });
  assert.equal(unpaid.statusCode, 402, unpaid.body);

  await app.close();
});
