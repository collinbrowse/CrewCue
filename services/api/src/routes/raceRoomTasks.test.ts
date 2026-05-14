import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { deleteTaskBoardSnapshot } from "../lib/roomPersistence.js";
import { clearTaskBoardLocalState } from "./raceRooms.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

test("returns role-scoped task board for authorized crew members", async () => {
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const crewMemberToken = app.jwt.sign(buildClaims("crew-member-user"));
  const crewChiefToken = app.jwt.sign(buildClaims("crew-chief-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "WS3 Task Board",
      creatorRole: "athlete"
    },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const payResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(payResponse.statusCode, 200);

  const activateResponse = await app.inject({
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
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(activateResponse.statusCode, 200);
  const activatedRoom = activateResponse.json() as {
    course: { checkpoints: Array<{ id: string }> };
  };

  for (const invitee of [
    { email: "crew-member@example.com", role: "crew_member" },
    { email: "crew-chief@example.com", role: "crew_chief" }
  ] as const) {
    const issueResponse = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites`,
      payload: invitee,
      headers: {
        authorization: `Bearer ${athleteToken}`
      }
    });
    assert.equal(issueResponse.statusCode, 201);
    const invite = issueResponse.json() as { token: string };

    const token = invitee.role === "crew_member" ? crewMemberToken : crewChiefToken;
    const acceptResponse = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites/accept`,
      payload: { token: invite.token },
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(acceptResponse.statusCode, 200);
  }

  const crewMemberBoard = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: {
      authorization: `Bearer ${crewMemberToken}`
    }
  });
  assert.equal(crewMemberBoard.statusCode, 200);
  const crewMemberPayload = crewMemberBoard.json() as {
    tasks: Array<{ id: string; checkpointId: string }>;
    assignments: Array<{ taskId: string; assigneeRole: string }>;
    checkpointPlans: Array<{ checkpointId: string }>;
  };
  assert.ok(crewMemberPayload.tasks.length >= 1);
  assert.ok(crewMemberPayload.assignments.length >= 1);
  assert.ok(crewMemberPayload.assignments.every((assignment) => assignment.assigneeRole === "crew_member"));
  assert.deepEqual(
    new Set(crewMemberPayload.tasks.map((task) => task.id)),
    new Set(crewMemberPayload.assignments.map((assignment) => assignment.taskId))
  );
  assert.deepEqual(
    new Set(crewMemberPayload.checkpointPlans.map((plan) => plan.checkpointId)),
    new Set(crewMemberPayload.tasks.map((task) => task.checkpointId))
  );

  const firstCheckpointId = activatedRoom.course.checkpoints[0]?.id;
  assert.ok(firstCheckpointId);
  const chiefBoardForCheckpoint = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks?checkpointId=${encodeURIComponent(firstCheckpointId)}`,
    headers: {
      authorization: `Bearer ${crewChiefToken}`
    }
  });
  assert.equal(chiefBoardForCheckpoint.statusCode, 200);
  const chiefPayload = chiefBoardForCheckpoint.json() as {
    tasks: Array<{ checkpointId: string }>;
    assignments: Array<{ assigneeRole: string }>;
  };
  assert.ok(chiefPayload.tasks.length >= 1);
  assert.ok(chiefPayload.tasks.every((task) => task.checkpointId === firstCheckpointId));
  assert.ok(chiefPayload.assignments.some((assignment) => assignment.assigneeRole === "crew_chief"));

  await app.close();
});

test("returns 403 when non-member tries to read task board", async () => {
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
      name: "Task Board Authz",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const getForbidden = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: {
      authorization: `Bearer ${strangerToken}`
    }
  });
  assert.equal(getForbidden.statusCode, 403);

  await app.close();
});

test("task board snapshot path matches canonical replay path", async () => {
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "Task Board Snapshots",
      creatorRole: "athlete"
    },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const payResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(payResponse.statusCode, 200);

  const activateResponse = await app.inject({
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
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(activateResponse.statusCode, 200);
  const activatedRoom = activateResponse.json() as {
    course: {
      checkpoints: Array<{ id: string; latitude: number; longitude: number }>;
      baselineTrack?: unknown;
    };
  };

  const initialBoardResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(initialBoardResponse.statusCode, 200);
  const initialBoard = initialBoardResponse.json() as {
    tasks: Array<{ id: string }>;
  };
  assert.ok(initialBoard.tasks.length >= 1);

  const taskId = initialBoard.tasks[0]!.id;
  const assignResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/assign`,
    payload: {
      assigneeUserId: "athlete-user",
      assigneeRole: "athlete"
    },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(assignResponse.statusCode, 200);

  const startResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/start`,
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(startResponse.statusCode, 200);

  const raceStartOnlyUpdate = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: activatedRoom.course.checkpoints,
        baselineTrack: activatedRoom.course.baselineTrack
      },
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T17:00:00.000Z"
    },
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(raceStartOnlyUpdate.statusCode, 200);

  clearTaskBoardLocalState(roomId);
  const snapshotResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(snapshotResponse.statusCode, 200);
  const snapshotBoard = snapshotResponse.json() as {
    tasks: Array<{ id: string; status: string }>;
    assignments: Array<{ taskId: string; assigneeUserId: string }>;
  };
  const persistedTask = snapshotBoard.tasks.find((task) => task.id === taskId);
  assert.equal(persistedTask?.status, "in_progress");
  const persistedAssignment = snapshotBoard.assignments.find((assignment) => assignment.taskId === taskId);
  assert.equal(persistedAssignment?.assigneeUserId, "athlete-user");

  await deleteTaskBoardSnapshot(roomId);
  clearTaskBoardLocalState(roomId);
  const replayResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: {
      authorization: `Bearer ${athleteToken}`
    }
  });
  assert.equal(replayResponse.statusCode, 200);
  assert.deepEqual(replayResponse.json(), snapshotBoard);

  await app.close();
});
