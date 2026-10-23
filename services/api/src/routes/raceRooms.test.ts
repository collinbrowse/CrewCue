import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { clearHttpIdempotencyStoreForTests } from "../lib/httpIdempotency.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import {
  loadTaskBoardPayload,
  persistTaskBoardPayload,
  setPersistRaceRoomFailureForTests
} from "../lib/roomPersistence.js";
import { ingestPersistedRaceRoomInviteWithoutClobberForTests } from "./raceRooms.js";
import type { RaceRoomInvite } from "@crewcue/contracts";

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

test("race room create retry after idempotency lease loss does not orphan a second room", async () => {
  const app = buildApp();
  await app.ready();

  const ownerSub = "owner-create-release-reclaim";
  const ownerToken = app.jwt.sign(buildClaims(ownerSub));
  const idempotencyKey = "create-room-release-after-save";
  const headers = {
    authorization: `Bearer ${ownerToken}`,
    "idempotency-key": idempotencyKey
  };
  const payload = {
    teamId: "team-1",
    athleteId: "athlete-1",
    name: "Release Reclaim Room",
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
  const firstBody = first.json() as { id: string };

  // Simulate release-after-save / complete failure: room row remains, lease is gone.
  clearHttpIdempotencyStoreForTests();

  const retry = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload,
    headers
  });
  assert.equal(retry.statusCode, 201);
  const retryBody = retry.json() as { id: string };
  assert.equal(retryBody.id, firstBody.id);

  const mine = await app.inject({
    method: "GET",
    url: "/race-rooms/mine",
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(mine.statusCode, 200);
  const rooms = (mine.json() as { rooms: { id: string; name: string }[] }).rooms.filter(
    (room) => room.name === "Release Reclaim Room"
  );
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.id, firstBody.id);

  await app.close();
});

test("PUT course releases idempotency key after validation failure", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-course-idempotent"));
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Course idempotency room",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const entitlementResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(entitlementResponse.statusCode, 200);

  const headers = {
    authorization: `Bearer ${ownerToken}`,
    "idempotency-key": `course-validation-release-${randomUUID()}`
  };
  const basePayload = {
    plannedPaceSecondsPerKm: 600,
    course: {
      checkpoints: [
        { id: "cp0", latitude: 41.0, longitude: -71.0 },
        { id: "cp1", latitude: 41.01, longitude: -71.0 }
      ]
    },
    raceStartAt: "2026-05-12T16:00:00.000Z"
  };

  const rejected = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: basePayload,
    headers
  });
  assert.equal(rejected.statusCode, 400);
  assert.match((rejected.json() as { error: string }).error, /Upload a GPX, JSON, or KML track/);

  const validPayload = {
    ...basePayload,
    routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
      { latitude: 41.0, longitude: -71.0 },
      { latitude: 41.01, longitude: -71.0 }
    ])
  };
  const accepted = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: validPayload,
    headers
  });
  assert.equal(accepted.statusCode, 200);
  const acceptedBody = accepted.json() as { id: string; course: { checkpoints: Array<{ id: string }> } };
  assert.equal(acceptedBody.id, roomId);
  assert.equal(acceptedBody.course.checkpoints.length, 2);

  const replay = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: validPayload,
    headers
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), acceptedBody);

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

test("stale invite hydrate does not reopen an accepted invite", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-stale-invite"));
  const inviteeToken = app.jwt.sign(buildClaims("invitee-stale-invite"));
  const replayToken = app.jwt.sign(buildClaims("replay-stale-invite"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Invite hydrate room",
      creatorName: "Owner User",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const room = createResponse.json() as { id: string };

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites`,
    payload: {
      email: "Crew@Example.com",
      role: "crew_member"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(issueResponse.statusCode, 201);
  const issued = issueResponse.json() as {
    token: string;
    roomId: string;
    email: string;
    role: RaceRoomInvite["role"];
    expiresAt: string;
  };
  const stalePendingInvite: RaceRoomInvite = {
    ...issued,
    status: "pending",
    invitedBy: "owner-stale-invite",
    invitedAt: "2026-08-15T13:00:00.000Z"
  };

  const accepted = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites/accept`,
    payload: { token: issued.token },
    headers: { authorization: `Bearer ${inviteeToken}` }
  });
  assert.equal(accepted.statusCode, 200);

  const liveAfterHydrate = ingestPersistedRaceRoomInviteWithoutClobberForTests(stalePendingInvite);
  assert.equal(liveAfterHydrate.status, "accepted");
  assert.equal(liveAfterHydrate.acceptedBy, "invitee-stale-invite");

  const replayAccept = await app.inject({
    method: "POST",
    url: `/race-rooms/${room.id}/invites/accept`,
    payload: { token: issued.token },
    headers: { authorization: `Bearer ${replayToken}` }
  });
  assert.equal(replayAccept.statusCode, 409);
  assert.match((replayAccept.json() as { error: string }).error, /not pending/);

  const listResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${room.id}/invites`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(listResponse.statusCode, 200);
  const listed = listResponse.json() as { invites: RaceRoomInvite[] };
  const listedInvite = listed.invites.find((invite) => invite.token === issued.token);
  assert.equal(listedInvite?.status, "accepted");
  assert.equal(listedInvite?.acceptedBy, "invitee-stale-invite");

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
      athleteId: "owner-user",
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

  const pingAtMs = Date.now();
  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 41.0,
      longitude: -71.0,
      recordedAt: new Date(pingAtMs).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(pingResponse.statusCode, 201);

  const manual = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/cp0/manual-stop`,
    payload: {
      arrivalAt: new Date(pingAtMs + 10_000).toISOString(),
      departureAt: new Date(pingAtMs + 170_000).toISOString()
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

test("PUT course keeps protocol notes and incidents when only cutoff or pace changes", async () => {
  const app = buildApp();
  await app.ready();

  const ownerToken = app.jwt.sign(buildClaims("owner-course-metadata"));
  const headers = { authorization: `Bearer ${ownerToken}` };
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "owner-course-metadata",
      name: "Cutoff edit room",
      creatorRole: "athlete"
    },
    headers
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const payResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers
  });
  assert.equal(payResponse.statusCode, 200);

  const checkpoints = [
    { id: "cp0", latitude: 42.0, longitude: -70.0 },
    { id: "cp1", latitude: 42.02, longitude: -70.0 }
  ];
  const activateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: { checkpoints },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints(checkpoints),
      plannedPaceSecondsPerKm: 600,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers
  });
  assert.equal(activateResponse.statusCode, 200);
  const savedCourse = (
    activateResponse.json() as {
      course: { checkpoints: Array<{ id: string; latitude: number; longitude: number }> };
    }
  ).course;

  const noteResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/protocol-notes`,
    payload: {
      checkpointId: "cp1",
      category: "nutrition",
      body: "Two gels at the second aid."
    },
    headers
  });
  assert.equal(noteResponse.statusCode, 200);
  const noteId = (noteResponse.json() as { protocolNote: { id: string } }).protocolNote.id;

  const incidentResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents`,
    payload: {
      category: "hydration",
      severity: "medium",
      checkpointId: "cp1",
      summary: "Crew missed the first bottle handoff"
    },
    headers
  });
  assert.equal(incidentResponse.statusCode, 201);
  const incidentId = (incidentResponse.json() as { incident: { id: string } }).incident.id;

  const metadataSave = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: savedCourse.checkpoints.map((checkpoint) =>
          checkpoint.id === "cp1"
            ? { ...checkpoint, cutoff: { mode: "elapsed_from_start", seconds: 4 * 60 * 60 } }
            : checkpoint
        )
      },
      plannedPaceSecondsPerKm: 540,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers
  });
  assert.equal(metadataSave.statusCode, 200);

  const notesAfterMetadata = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/protocol-notes`,
    headers
  });
  assert.equal(notesAfterMetadata.statusCode, 200);
  const notes = (notesAfterMetadata.json() as { protocolNotes: Array<{ id: string; body: string }> }).protocolNotes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.id, noteId);
  assert.equal(notes[0]?.body, "Two gels at the second aid.");

  const incidentsAfterMetadata = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/incidents`,
    headers
  });
  assert.equal(incidentsAfterMetadata.statusCode, 200);
  const incidents = (incidentsAfterMetadata.json() as { incidents: Array<{ id: string }> }).incidents;
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.id, incidentId);

  const moved = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: savedCourse.checkpoints.map((checkpoint) =>
          checkpoint.id === "cp1" ? { ...checkpoint, latitude: checkpoint.latitude + 0.05 } : checkpoint
        )
      },
      plannedPaceSecondsPerKm: 540,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers
  });
  assert.equal(moved.statusCode, 200);

  const notesAfterMove = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/protocol-notes`,
    headers
  });
  assert.equal(notesAfterMove.statusCode, 200);
  assert.equal(
    (notesAfterMove.json() as { protocolNotes: unknown[] }).protocolNotes.length,
    0
  );

  const incidentsAfterMove = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/incidents`,
    headers
  });
  assert.equal(incidentsAfterMove.statusCode, 200);
  assert.equal((incidentsAfterMove.json() as { incidents: unknown[] }).incidents.length, 0);

  await app.close();
});

test("PUT course keeps task board when room persist fails after reset would wipe", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-course-wipe"));

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: {
        teamId: "team-1",
        athleteId: "athlete-1",
        name: "Course wipe room",
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

    const boardMarker = { version: 1, marker: "keep-me-on-failed-course-put" };
    await persistTaskBoardPayload(roomId, boardMarker);

    setPersistRaceRoomFailureForTests(true);
    const failingUpdate = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/course`,
      payload: {
        plannedPaceSecondsPerKm: 600,
        course: {
          checkpoints: [
            { id: "cp0", latitude: 41.0, longitude: -71.0 },
            { id: "cp1", latitude: 41.02, longitude: -71.01 }
          ]
        },
        routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
          { latitude: 41.0, longitude: -71.0 },
          { latitude: 41.02, longitude: -71.01 }
        ]),
        raceStartAt: "2026-05-12T16:00:00.000Z"
      },
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": "course-put-persist-fail"
      }
    });
    assert.equal(failingUpdate.statusCode, 500);

    assert.deepEqual(await loadTaskBoardPayload(roomId), boardMarker);
  } finally {
    setPersistRaceRoomFailureForTests(false);
    await app.close();
  }
});

test("DELETE checkpoint keeps task board when room persist fails", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-checkpoint-delete-wipe"));

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: {
        teamId: "team-1",
        athleteId: "athlete-1",
        name: "Checkpoint delete wipe room",
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

    const points = [
      { latitude: 41.0, longitude: -71.0 },
      { latitude: 41.01, longitude: -71.0 },
      { latitude: 41.02, longitude: -71.0 }
    ];
    const activateResponse = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/course`,
      payload: {
        course: {
          checkpoints: [
            { id: "cp0", ...points[0] },
            { id: "cp1", ...points[1] },
            { id: "cp2", ...points[2] }
          ]
        },
        routeOverlayLayer: lineStringRouteOverlayForCheckpoints(points),
        plannedPaceSecondsPerKm: 600,
        raceStartAt: "2026-05-12T16:00:00.000Z"
      },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(activateResponse.statusCode, 200, activateResponse.body);

    const boardMarker = { version: 1, marker: "keep-me-on-failed-checkpoint-delete" };
    await persistTaskBoardPayload(roomId, boardMarker);

    setPersistRaceRoomFailureForTests(true);
    const failingDelete = await app.inject({
      method: "DELETE",
      url: `/race-rooms/${roomId}/checkpoints/cp1`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(failingDelete.statusCode, 500);
    assert.deepEqual(await loadTaskBoardPayload(roomId), boardMarker);
  } finally {
    setPersistRaceRoomFailureForTests(false);
    await app.close();
  }
});

test("PUT map-workspace keeps task board when room persist fails", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-workspace-wipe"));

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/race-rooms",
      payload: {
        teamId: "team-1",
        athleteId: "athlete-1",
        name: "Workspace wipe room",
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

    const boardMarker = { version: 1, marker: "keep-me-on-failed-workspace-put" };
    await persistTaskBoardPayload(roomId, boardMarker);

    setPersistRaceRoomFailureForTests(true);
    const overlay = lineStringRouteOverlayForCheckpoints([
      { latitude: 40.0, longitude: -70.0 },
      { latitude: 40.01, longitude: -70.0 }
    ]);
    const failingUpdate = await app.inject({
      method: "PUT",
      url: `/race-rooms/${roomId}/map-workspace`,
      payload: {
        layers: [overlay],
        selectedLayerId: overlay.id,
        drivesProjectionLayerId: overlay.id,
        checkpoints: [
          { id: "cp0", latitude: 40.0, longitude: -70.0 },
          { id: "cp1", latitude: 40.01, longitude: -70.0 }
        ]
      },
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    assert.equal(failingUpdate.statusCode, 500);
    assert.deepEqual(await loadTaskBoardPayload(roomId), boardMarker);
  } finally {
    setPersistRaceRoomFailureForTests(false);
    await app.close();
  }
});
