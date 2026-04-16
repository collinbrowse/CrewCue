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
    method: "POST",
    url: `/race-rooms/${roomId}/activate`,
    payload: {
      eventEndsAt: new Date(Date.now() + 60_000).toISOString()
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
