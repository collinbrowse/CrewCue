import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { getRoomPersistenceMode } from "../lib/roomPersistence.js";
import { runInFreshProcess } from "../lib/testFreshProcess.js";
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

type RemovalFixture = {
  app: ReturnType<typeof buildApp>;
  roomId: string;
  joinCode: string;
  as: (sub: string) => { authorization: string };
};

/** Owner-run room on the Full Crew tier, so seat limits never decide these tests. */
async function removalFixture(): Promise<RemovalFixture> {
  const app = buildApp();
  await app.ready();
  const as = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign(buildClaims(sub))}` });
  const created = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: { teamId: "team-1", athleteId: "athlete-user", name: "Race Room", creatorRole: "athlete" },
    headers: as("athlete-user")
  });
  assert.equal(created.statusCode, 201);
  const room = created.json() as { id: string; joinCode: string };
  const paid = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/entitlement`,
    payload: { status: "paid", crewTier: "unlimited" },
    headers: as("athlete-user")
  });
  assert.equal(paid.statusCode, 200);
  return { app, roomId: room.id, joinCode: room.joinCode, as };
}

async function issueInvite(
  f: RemovalFixture,
  by: string,
  role: string,
  expiresAt?: string
): Promise<{ statusCode: number; token: string }> {
  const res = await f.app.inject({
    method: "POST",
    url: `/race-rooms/${f.roomId}/invites`,
    payload: { email: `${role}-${by}@example.com`, role, ...(expiresAt ? { expiresAt } : {}) },
    headers: f.as(by)
  });
  return { statusCode: res.statusCode, token: (res.json() as { token?: string }).token ?? "" };
}

async function acceptInvite(f: RemovalFixture, sub: string, token: string): Promise<number> {
  const res = await f.app.inject({
    method: "POST",
    url: `/race-rooms/${f.roomId}/invites/accept`,
    payload: { token },
    headers: f.as(sub)
  });
  return res.statusCode;
}

async function joinByCode(f: RemovalFixture, sub: string): Promise<number> {
  const res = await f.app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: { roomCode: f.joinCode },
    headers: f.as(sub)
  });
  return res.statusCode;
}

async function removeMember(f: RemovalFixture, sub: string): Promise<void> {
  const res = await f.app.inject({
    method: "DELETE",
    url: `/race-rooms/${f.roomId}/members/${sub}`,
    headers: f.as("athlete-user")
  });
  assert.equal(res.statusCode, 200);
}

async function canReadRoom(f: RemovalFixture, sub: string): Promise<boolean> {
  const res = await f.app.inject({ method: "GET", url: `/race-rooms/${f.roomId}`, headers: f.as(sub) });
  return res.statusCode === 200;
}

test("a member the owner removed stays out when they use the room code again", async () => {
  const f = await removalFixture();
  assert.equal(await joinByCode(f, "crew-user"), 200);
  await removeMember(f, "crew-user");

  assert.equal(await joinByCode(f, "crew-user"), 404);
  assert.equal(await canReadRoom(f, "crew-user"), false);

  // Everyone else can still join with the same code.
  assert.equal(await joinByCode(f, "new-crew-user"), 200);
  await f.app.close();
});

test("an invite stops working once its issuer can no longer invite", async () => {
  const f = await removalFixture();
  const chief = await issueInvite(f, "athlete-user", "crew_chief");
  assert.equal(await acceptInvite(f, "chief-user", chief.token), 200);

  const fromChief = await issueInvite(f, "chief-user", "crew_member");
  const fromChiefForFriend = await issueInvite(f, "chief-user", "crew_member");
  assert.equal(fromChief.statusCode, 201);
  await removeMember(f, "chief-user");

  assert.equal(await acceptInvite(f, "chief-user", fromChief.token), 410);
  assert.equal(await acceptInvite(f, "friend-user", fromChiefForFriend.token), 410);
  assert.equal(await canReadRoom(f, "chief-user"), false);
  assert.equal(await canReadRoom(f, "friend-user"), false);
  await f.app.close();
});

test("an invite from a demoted crew chief no longer admits anyone", async () => {
  const f = await removalFixture();
  const chief = await issueInvite(f, "athlete-user", "crew_chief");
  assert.equal(await acceptInvite(f, "chief-user", chief.token), 200);
  const fromChief = await issueInvite(f, "chief-user", "crew_member");

  const demoted = await f.app.inject({
    method: "PATCH",
    url: `/race-rooms/${f.roomId}/members/chief-user`,
    payload: { role: "crew_member" },
    headers: f.as("athlete-user")
  });
  assert.equal(demoted.statusCode, 200);

  assert.equal(await acceptInvite(f, "friend-user", fromChief.token), 410);
  await f.app.close();
});

test("only a newer invite from the owner brings a removed member back", async () => {
  const f = await removalFixture();
  const olderOwnerInvite = await issueInvite(f, "athlete-user", "crew_member");
  const chief = await issueInvite(f, "athlete-user", "crew_chief");
  assert.equal(await acceptInvite(f, "chief-user", chief.token), 200);
  assert.equal(await joinByCode(f, "crew-user"), 200);
  await removeMember(f, "crew-user");

  // An owner invite from before the removal, or one from crew, does not readmit them.
  assert.equal(await acceptInvite(f, "crew-user", olderOwnerInvite.token), 403);
  const fromChief = await issueInvite(f, "chief-user", "crew_member");
  assert.equal(await acceptInvite(f, "crew-user", fromChief.token), 403);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const fresh = await issueInvite(f, "athlete-user", "crew_member");
  assert.equal(await acceptInvite(f, "crew-user", fresh.token), 200);
  assert.equal(await canReadRoom(f, "crew-user"), true);

  // Removing them again blocks the room code again.
  await removeMember(f, "crew-user");
  assert.equal(await joinByCode(f, "crew-user"), 404);
  await f.app.close();
});

test(
  "a crew member the owner removed stays out after an API restart until the owner sends a new invite",
  { skip: getRoomPersistenceMode() !== "postgres" && "needs Postgres (test:pg)", timeout: 60_000 },
  async () => {
    const f = await removalFixture();
    const removed = `removed-crew-${randomUUID().slice(0, 8)}`;
    const staysCrew = `kept-crew-${randomUUID().slice(0, 8)}`;
    const olderOwnerInvite = await issueInvite(f, "athlete-user", "crew_member");
    assert.equal(olderOwnerInvite.statusCode, 201);
    assert.equal(await joinByCode(f, removed), 200);
    assert.equal(await joinByCode(f, staysCrew), 200);
    await removeMember(f, removed);
    await f.app.close();

    // A fresh process has nothing in memory: who was removed, and when, must come from Postgres.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const script = `
      const { buildApp } = await import(process.argv[1]);
      const [roomId, joinCode, oldInvite, owner, removed, kept] = process.argv.slice(2);
      const app = buildApp();
      await app.ready();
      const call = async (method, url, token, payload) => {
        const res = await app.inject({ method, url, payload, headers: { authorization: "Bearer " + token } });
        return res.statusCode;
      };
      const out = {
        removedRoom: await call("GET", "/race-rooms/" + roomId, removed),
        removedProgress: await call("GET", "/race-rooms/" + roomId + "/pings/latest", removed),
        removedByCode: await call("POST", "/race-rooms/join-by-code", removed, { roomCode: joinCode }),
        removedOldInvite: await call("POST", "/race-rooms/" + roomId + "/invites/accept", removed, { token: oldInvite }),
        keptProgress: await call("GET", "/race-rooms/" + roomId + "/pings/latest", kept)
      };
      const fresh = await app.inject({
        method: "POST",
        url: "/race-rooms/" + roomId + "/invites",
        payload: { email: "back@example.com", role: "crew_member" },
        headers: { authorization: "Bearer " + owner }
      });
      out.freshInvite = fresh.statusCode;
      out.freshAccept = await call("POST", "/race-rooms/" + roomId + "/invites/accept", removed, { token: fresh.json().token });
      out.backInRoom = await call("GET", "/race-rooms/" + roomId, removed);
      process.stdout.write("\\nRESULT:" + JSON.stringify(out) + "\\n");
      await app.close();
      process.exit(0);
    `;
    const token = (sub: string) => f.as(sub).authorization.slice("Bearer ".length);
    const result = runInFreshProcess<Record<string, number>>(script, [
      f.roomId,
      f.joinCode,
      olderOwnerInvite.token,
      token("athlete-user"),
      token(removed),
      token(staysCrew)
    ]);
    assert.equal(result.removedRoom, 403, "the removed member cannot open the race");
    assert.equal(result.removedProgress, 403, "the removed member cannot read the runner's progress");
    assert.equal(result.removedByCode, 404, "the room code does not let them back in");
    assert.equal(result.removedOldInvite, 403, "an owner invite from before the removal does not let them back in");
    assert.equal(result.keptProgress, 200, "the rest of the crew still read the runner's progress");
    assert.equal(result.freshInvite, 201);
    assert.equal(result.freshAccept, 200, "a new invite from the owner brings them back");
    assert.equal(result.backInRoom, 200);
  }
);

test("invites stay open for at most seven days", async () => {
  const f = await removalFixture();
  const day = 24 * 60 * 60 * 1000;
  const tooLong = await issueInvite(f, "athlete-user", "crew_member", new Date(Date.now() + 8 * day).toISOString());
  assert.equal(tooLong.statusCode, 400);
  const past = await issueInvite(f, "athlete-user", "crew_member", new Date(Date.now() - 1000).toISOString());
  assert.equal(past.statusCode, 400);
  const week = await issueInvite(f, "athlete-user", "crew_member", new Date(Date.now() + 7 * day - 60_000).toISOString());
  assert.equal(week.statusCode, 201);
  const defaulted = await f.app.inject({
    method: "POST",
    url: `/race-rooms/${f.roomId}/invites`,
    payload: { email: "default@example.com", role: "crew_member" },
    headers: f.as("athlete-user")
  });
  const expiresAt = Date.parse((defaulted.json() as { expiresAt: string }).expiresAt);
  assert.ok(expiresAt <= Date.now() + day + 1000, "default invite lasts one day");
  await f.app.close();
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
