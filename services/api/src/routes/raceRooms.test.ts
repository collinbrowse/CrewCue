import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { setPersistRaceRoomFailureForTests } from "../lib/roomPersistence.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

test("race room creation replays idempotent retries and rejects conflicting reuse", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-idempotent"));
  const headers = {
    authorization: `Bearer ${ownerToken}`,
    "idempotency-key": "create-race-room-route-retry"
  };
  const payload = {
    teamId: "team-1",
    athleteId: "athlete-1",
    name: "Race Room",
    creatorName: "Owner User",
    creatorRole: "team_manager"
  };

  const first = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload,
    headers
  });
  assert.equal(first.statusCode, 201);
  const firstBody = first.json() as { id: string; name: string };

  const retry = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload,
    headers
  });
  assert.equal(retry.statusCode, 201);
  const retryBody = retry.json() as { id: string; name: string };
  assert.equal(retryBody.id, firstBody.id);
  assert.equal(retryBody.name, firstBody.name);

  const conflict = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      ...payload,
      name: "Different Race Room"
    },
    headers
  });
  assert.equal(conflict.statusCode, 409);
  assert.match((conflict.json() as { error: string }).error, /different request body/);

  await app.close();
});

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
      creatorName: "Owner User",
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
      creatorName: "Owner User",
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
      creatorName: "Owner User",
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
      creatorName: "Owner User",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string };

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

  const updateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${room.id}/course`,
    payload: {
      plannedPaceSecondsPerKm: 360,
      course: {
        checkpoints: [
          { id: "aid-1", latitude: 40.7128, longitude: -74.006, plannedStopSeconds: 120 },
          { id: "aid-2", latitude: 40.7228, longitude: -73.996, plannedStopSeconds: 120 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 40.7128, longitude: -74.006 },
        { latitude: 40.7228, longitude: -73.996 }
      ]),
      raceStartAt: "2026-05-12T16:00:00.000Z"
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

test("updates course with routeOverlayLayer merges canonical map workspace layer", async () => {
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
      creatorName: "Owner User",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string };

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

  const updateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${room.id}/course`,
    payload: {
      plannedPaceSecondsPerKm: 360,
      course: {
        checkpoints: [
          { id: "aid-1", latitude: 40.7128, longitude: -74.006, plannedStopSeconds: 120 },
          { id: "aid-2", latitude: 40.7228, longitude: -73.996, plannedStopSeconds: 120 }
        ]
      },
      routeOverlayLayer: {
        id: "client-temp-id",
        label: "Marathon",
        visible: true,
        sourceFileName: "race.gpx",
        geometry: {
          type: "LineString",
          coordinates: [
            [-74.006, 40.7128],
            [-73.996, 40.7228]
          ]
        }
      },
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });

  assert.equal(updateResponse.statusCode, 200);

  const wsResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${room.id}/map-workspace`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(wsResponse.statusCode, 200);
  const body = wsResponse.json() as {
    mapWorkspace: { layers: Array<{ id: string }>; checkpoints: Array<{ id: string }> };
  };
  assert.ok(body.mapWorkspace.layers.some((layer) => layer.id === "crewcue-primary-course-route"));
  assert.equal(body.mapWorkspace.checkpoints.length, 2);
  assert.equal(body.mapWorkspace.checkpoints[0]?.id, "aid-1");

  await app.close();
});

test("lists room invites with current statuses", async () => {
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
      creatorName: "Owner User",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string };

  const inviteResponse = await app.inject({
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
  assert.equal(inviteResponse.statusCode, 201);

  const listResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${room.id}/invites`,
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(listResponse.statusCode, 200);
  const listed = listResponse.json() as { invites: Array<{ email: string; status: string }> };
  assert.equal(listed.invites.length, 1);
  assert.equal(listed.invites[0]?.email, "crew@example.com");
  assert.equal(listed.invites[0]?.status, "pending");

  await app.close();
});

test("joins room by room code and creates membership", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const joinerToken = app.jwt.sign(buildClaims("joiner-user"));
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Race Room",
      creatorName: "Owner User",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string; joinCode?: string };
  assert.ok(room.joinCode && /^\d{6}$/.test(room.joinCode), "create assigns 6-digit joinCode");

  const joinResponse = await app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: {
      roomCode: room.joinCode
    },
    headers: {
      authorization: `Bearer ${joinerToken}`
    }
  });
  assert.equal(joinResponse.statusCode, 200);
  const joined = joinResponse.json() as { assignedRole: string; room: { memberships: Array<{ userId: string }> } };
  assert.equal(joined.assignedRole, "crew_member");
  assert.equal(joined.room.memberships.some((membership) => membership.userId === "joiner-user"), true);

  await app.close();
});

test("member can PATCH own displayName and owner syncs creatorName when athlete updates", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const joinerToken = app.jwt.sign(buildClaims("joiner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "owner-user",
      name: "Room With Names",
      creatorName: "Original Owner",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string; joinCode?: string };

  const joinResponse = await app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: { roomCode: room.joinCode },
    headers: { authorization: `Bearer ${joinerToken}` }
  });
  assert.equal(joinResponse.statusCode, 200);

  const joinerPatch = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${room.id}/members/joiner-user`,
    payload: { displayName: "Crew Pat" },
    headers: { authorization: `Bearer ${joinerToken}` }
  });
  assert.equal(joinerPatch.statusCode, 200);
  const joinerBody = joinerPatch.json() as {
    room: { memberships: Array<{ userId: string; displayName?: string }> };
  };
  const jm = joinerBody.room.memberships.find((m) => m.userId === "joiner-user");
  assert.equal(jm?.displayName, "Crew Pat");

  const ownerPatch = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${room.id}/members/owner-user`,
    payload: { displayName: "Updated Owner" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(ownerPatch.statusCode, 200);
  const ownerBody = ownerPatch.json() as {
    room: { creatorName?: string; memberships: Array<{ userId: string; displayName?: string }> };
  };
  assert.equal(ownerBody.room.creatorName, "Updated Owner");
  const om = ownerBody.room.memberships.find((m) => m.userId === "owner-user");
  assert.equal(om?.displayName, "Updated Owner");

  const joinerCannotPatchOther = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${room.id}/members/owner-user`,
    payload: { displayName: "Hijack" },
    headers: { authorization: `Bearer ${joinerToken}` }
  });
  assert.equal(joinerCannotPatchOther.statusCode, 403);

  await app.close();
});

test("join-by-code rejects non-6-digit room codes", async () => {
  const app = buildApp();
  await app.ready();

  const joinerToken = app.jwt.sign(buildClaims("joiner-user"));
  const joinResponse = await app.inject({
    method: "POST",
    url: "/race-rooms/join-by-code",
    payload: {
      roomCode: "not-a-code"
    },
    headers: {
      authorization: `Bearer ${joinerToken}`
    }
  });
  assert.equal(joinResponse.statusCode, 400);

  await app.close();
});

test("join-by-code does not keep ghost membership when room persist fails", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-join-persist"));
  const joinerToken = app.jwt.sign(buildClaims("joiner-join-persist"));

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: {
        teamId: "team-1",
        athleteId: "owner-join-persist",
        name: "Join Persist Room",
        creatorRole: "athlete"
      },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(createResponse.statusCode, 201);
    const room = createResponse.json() as { id: string; joinCode?: string };
    assert.ok(room.joinCode);

    setPersistRaceRoomFailureForTests(true);
    const failingJoin = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: room.joinCode },
      headers: { authorization: `Bearer ${joinerToken}` }
    });
    assert.equal(failingJoin.statusCode, 500);

    // /mine reads the in-process room cache; a ghost membership after a failed
    // persist would incorrectly list this room for the joiner.
    const mineAfterFailure = await app.inject({
      method: "GET",
      url: "/race-rooms/mine",
      headers: { authorization: `Bearer ${joinerToken}` }
    });
    assert.equal(mineAfterFailure.statusCode, 200);
    const mineBody = mineAfterFailure.json() as { rooms: Array<{ id: string }> };
    assert.equal(
      mineBody.rooms.some((r) => r.id === room.id),
      false,
      "failed join must not leave membership in the process cache"
    );

    setPersistRaceRoomFailureForTests(false);
    const retryJoin = await app.inject({
      method: "POST",
      url: "/race-rooms/join-by-code",
      payload: { roomCode: room.joinCode },
      headers: { authorization: `Bearer ${joinerToken}` }
    });
    assert.equal(retryJoin.statusCode, 200);
    const retried = retryJoin.json() as {
      room: { memberships: Array<{ userId: string }> };
    };
    assert.equal(
      retried.room.memberships.some((m) => m.userId === "joiner-join-persist"),
      true
    );
  } finally {
    setPersistRaceRoomFailureForTests(false);
    await app.close();
  }
});

test("lists race rooms for authenticated member via mine endpoint", async () => {
  const app = buildApp();
  await app.ready();

  const userAToken = app.jwt.sign(buildClaims("user-a"));
  const userBToken = app.jwt.sign(buildClaims("user-b"));

  const roomA = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-a",
      name: "Room A",
      creatorName: "User A",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${userAToken}`
    }
  });
  const roomAId = (roomA.json() as { id: string }).id;

  await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-b",
      name: "Room B",
      creatorName: "User B",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${userBToken}`
    }
  });

  const listMine = await app.inject({
    method: "GET",
    url: "/race-rooms/mine",
    headers: {
      authorization: `Bearer ${userAToken}`
    }
  });
  assert.equal(listMine.statusCode, 200);
  const payloadMine = listMine.json() as { rooms: Array<{ id: string }> };
  assert.equal(payloadMine.rooms.some((room) => room.id === roomAId), true);
  assert.equal(payloadMine.rooms.length >= 1, true);

  await app.close();
});

test("lists only caller-visible race rooms for team", async () => {
  const app = buildApp();
  await app.ready();

  const userAToken = app.jwt.sign(buildClaims("user-a"));
  const userBToken = app.jwt.sign(buildClaims("user-b"));

  const roomA = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-a",
      name: "Room A",
      creatorName: "User A",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${userAToken}`
    }
  });
  const roomAId = (roomA.json() as { id: string }).id;

  const roomB = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-b",
      name: "Room B",
      creatorName: "User B",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${userBToken}`
    }
  });
  const roomBId = (roomB.json() as { id: string }).id;

  const listA = await app.inject({
    method: "GET",
    url: "/teams/team-1/race-rooms",
    headers: {
      authorization: `Bearer ${userAToken}`
    }
  });
  assert.equal(listA.statusCode, 200);
  const payloadA = listA.json() as { rooms: Array<{ id: string }> };
  assert.equal(payloadA.rooms.some((room) => room.id === roomAId), true);
  assert.equal(payloadA.rooms.some((room) => room.id === roomBId), false);

  await app.close();
});

test("lists mobile-ops-team races when JWT has empty teamIds (mobile demo parity)", async () => {
  const app = buildApp();
  await app.ready();

  const token = app.jwt.sign({
    sub: "no-team-user",
    teamIds: [],
    roomRoles: {}
  });
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "mobile-ops-team",
      athleteId: "athlete-1",
      name: "Fallback team room",
      creatorName: "No Team User",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const listResponse = await app.inject({
    method: "GET",
    url: "/teams/mobile-ops-team/race-rooms",
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert.equal(listResponse.statusCode, 200);
  const payload = listResponse.json() as { rooms: Array<{ id: string }> };
  assert.equal(payload.rooms.some((room) => room.id === roomId), true);

  await app.close();
});

test("returns anonymous join preview with allowlisted room details", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Western States Build",
      creatorName: "Owner User",
      creatorRole: "athlete"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string; joinCode: string };

  const previewResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/join-preview/${room.joinCode}`
  });
  assert.equal(previewResponse.statusCode, 200);
  const payload = previewResponse.json() as { preview: { roomName: string; joinCode: string; members: Array<{ role: string }> } };
  assert.equal(payload.preview.roomName, "Western States Build");
  assert.equal(payload.preview.joinCode, room.joinCode);
  assert.equal(payload.preview.members.length >= 1, true);
  assert.equal(payload.preview.members[0]?.role, "athlete");

  await app.close();
});

test("PUT course rejects removing a visited checkpoint", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Visited CP room",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const activateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 41.0, longitude: -71.0 },
          { id: "cp1", latitude: 41.01, longitude: -71.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 41.0, longitude: -71.0 },
        { latitude: 41.01, longitude: -71.0 }
      ]),
      plannedPaceSecondsPerKm: 600,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(activateResponse.statusCode, 200);
  const activatedAt = (activateResponse.json() as { activatedAt: string }).activatedAt;
  const activatedAtMs = Date.parse(activatedAt);

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 41.0,
      longitude: -71.0,
      recordedAt: new Date(activatedAtMs + 30_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const manual = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/cp0/manual-stop`,
    payload: {
      arrivalAt: new Date(activatedAtMs + 40_000).toISOString(),
      departureAt: new Date(activatedAtMs + 200_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(manual.statusCode, 200);

  const badUpdate = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: 600,
      course: {
        checkpoints: [
          { id: "cp1", latitude: 41.01, longitude: -71.0 },
          { id: "cp-new", latitude: 41.02, longitude: -71.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 41.01, longitude: -71.0 },
        { latitude: 41.02, longitude: -71.0 }
      ]),
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(badUpdate.statusCode, 400);

  const goodUpdate = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: 600,
      course: {
        checkpoints: [
          { id: "cp0", latitude: 41.0, longitude: -71.0, title: "Renamed" },
          { id: "cp1", latitude: 41.01, longitude: -71.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 41.0, longitude: -71.0 },
        { latitude: 41.01, longitude: -71.0 }
      ]),
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(goodUpdate.statusCode, 200);
  const body = goodUpdate.json() as { course: { checkpoints: Array<{ id: string; title?: string }> } };
  assert.equal(body.course.checkpoints[0]?.title, "Renamed");

  await app.close();
});
