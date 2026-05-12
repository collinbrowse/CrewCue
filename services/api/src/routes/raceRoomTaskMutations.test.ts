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

async function setupPaidActiveRoomWithCrew(app: ReturnType<typeof buildApp>) {
  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const crewMemberToken = app.jwt.sign(buildClaims("crew-member-user"));
  const crewChiefToken = app.jwt.sign(buildClaims("crew-chief-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "WS3 Task Mutations",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  const payResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
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
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(activateResponse.statusCode, 200);

  for (const invitee of [
    { email: "crew-member@example.com", role: "crew_member" as const },
    { email: "crew-chief@example.com", role: "crew_chief" as const }
  ]) {
    const issueResponse = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites`,
      payload: invitee,
      headers: { authorization: `Bearer ${athleteToken}` }
    });
    assert.equal(issueResponse.statusCode, 201);
    const invite = issueResponse.json() as { token: string };
    const token = invitee.role === "crew_member" ? crewMemberToken : crewChiefToken;
    const acceptResponse = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/invites/accept`,
      payload: { token: invite.token },
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(acceptResponse.statusCode, 200);
  }

  return { roomId, athleteToken, crewMemberToken, crewChiefToken };
}

test("assign → start → complete happy path", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, crewMemberToken, crewChiefToken } = await setupPaidActiveRoomWithCrew(app);

  const boardResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(boardResponse.statusCode, 200);
  const chiefBoard = boardResponse.json() as { tasks: Array<{ id: string; status: string }> };
  const taskId = chiefBoard.tasks[0]?.id;
  assert.ok(taskId);

  const assignResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/assign`,
    payload: { assigneeUserId: "crew-member-user", assigneeRole: "crew_member" },
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(assignResponse.statusCode, 200);

  const startResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/start`,
    headers: { authorization: `Bearer ${crewMemberToken}` }
  });
  assert.equal(startResponse.statusCode, 200);
  assert.equal((startResponse.json() as { task: { status: string } }).task.status, "in_progress");

  const completeResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/complete`,
    headers: { authorization: `Bearer ${crewMemberToken}` }
  });
  assert.equal(completeResponse.statusCode, 200);
  assert.equal((completeResponse.json() as { task: { status: string } }).task.status, "completed");

  await app.close();
});

test("returns 403 when crew_member tries to assign", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, crewMemberToken, crewChiefToken } = await setupPaidActiveRoomWithCrew(app);

  const boardResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  const taskId = (boardResponse.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

  const denied = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/assign`,
    payload: { assigneeUserId: "crew-member-user", assigneeRole: "crew_member" },
    headers: { authorization: `Bearer ${crewMemberToken}` }
  });
  assert.equal(denied.statusCode, 403);

  await app.close();
});

test("returns 409 when completing a pending task", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, crewMemberToken, crewChiefToken } = await setupPaidActiveRoomWithCrew(app);

  const boardResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  const tasks = (boardResponse.json() as { tasks: Array<{ id: string }> }).tasks;
  const taskId = tasks[1]?.id ?? tasks[0]!.id;

  const assignResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/assign`,
    payload: { assigneeUserId: "crew-member-user", assigneeRole: "crew_member" },
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(assignResponse.statusCode, 200);

  const completePending = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/complete`,
    headers: { authorization: `Bearer ${crewMemberToken}` }
  });
  assert.equal(completePending.statusCode, 409);

  await app.close();
});

test("returns 403 when non-member attempts task mutation", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, crewChiefToken } = await setupPaidActiveRoomWithCrew(app);
  const strangerToken = app.jwt.sign(buildClaims("stranger-user"));

  const boardResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  const taskId = (boardResponse.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

  const denied = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/start`,
    headers: { authorization: `Bearer ${strangerToken}` }
  });
  assert.equal(denied.statusCode, 403);

  await app.close();
});
