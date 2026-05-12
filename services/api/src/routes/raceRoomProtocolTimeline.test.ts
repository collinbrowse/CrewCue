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
      name: "WS3 Protocol + Timeline",
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
  const checkpointId = (
    activateResponse.json() as { course: { checkpoints: Array<{ id: string }> } }
  ).course.checkpoints[0]!.id;

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

  return { roomId, checkpointId, athleteToken, crewMemberToken, crewChiefToken };
}

test("protocol note upsert + checkpoint filter works for authorized crew", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, checkpointId, crewChiefToken } = await setupPaidActiveRoomWithCrew(app);

  const writeResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/protocol-notes`,
    payload: {
      checkpointId,
      category: "nutrition",
      body: "Target 60g carbs in first bottle."
    },
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(writeResponse.statusCode, 200);
  const created = writeResponse.json() as { protocolNote: { id: string; body: string } };

  const updateResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/protocol-notes`,
    payload: {
      checkpointId,
      category: "nutrition",
      body: "Target 70g carbs in first bottle."
    },
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(updateResponse.statusCode, 200);
  const updated = updateResponse.json() as { protocolNote: { id: string; body: string } };
  assert.equal(updated.protocolNote.id, created.protocolNote.id);
  assert.equal(updated.protocolNote.body, "Target 70g carbs in first bottle.");

  const listResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/protocol-notes?checkpointId=${encodeURIComponent(checkpointId)}`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(listResponse.statusCode, 200);
  const listed = listResponse.json() as {
    protocolNotes: Array<{ checkpointId: string; category: string; body: string }>;
  };
  assert.equal(listed.protocolNotes.length, 1);
  assert.equal(listed.protocolNotes[0]!.checkpointId, checkpointId);
  assert.equal(listed.protocolNotes[0]!.category, "nutrition");

  await app.close();
});

test("timeline includes ordered task and protocol events", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, checkpointId, crewChiefToken, crewMemberToken } = await setupPaidActiveRoomWithCrew(app);

  const boardResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/tasks`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(boardResponse.statusCode, 200);
  const taskId = (boardResponse.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

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

  const completeResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/tasks/${taskId}/complete`,
    headers: { authorization: `Bearer ${crewMemberToken}` }
  });
  assert.equal(completeResponse.statusCode, 200);

  const protocolResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/protocol-notes`,
    payload: {
      checkpointId,
      category: "heat",
      body: "Ice sleeves if temp exceeds 75F."
    },
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(protocolResponse.statusCode, 200);

  const timelineResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/timeline`,
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(timelineResponse.statusCode, 200);
  const timeline = timelineResponse.json() as {
    events: Array<{ kind: string; occurredAt: string }>;
  };
  assert.ok(timeline.events.length >= 4);

  const kinds = timeline.events.map((event) => event.kind);
  for (const expected of ["task_assigned", "task_started", "task_completed", "protocol_updated"]) {
    assert.ok(kinds.includes(expected));
  }

  const sorted = [...timeline.events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  assert.deepEqual(
    timeline.events.map((event) => event.occurredAt),
    sorted.map((event) => event.occurredAt)
  );

  await app.close();
});

test("forbids non-members from reading protocol notes and timeline", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, crewChiefToken } = await setupPaidActiveRoomWithCrew(app);
  const strangerToken = app.jwt.sign(buildClaims("stranger-user"));

  const notesDenied = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/protocol-notes`,
    headers: { authorization: `Bearer ${strangerToken}` }
  });
  assert.equal(notesDenied.statusCode, 403);

  const timelineDenied = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/timeline`,
    headers: { authorization: `Bearer ${strangerToken}` }
  });
  assert.equal(timelineDenied.statusCode, 403);

  const unknownCheckpoint = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/protocol-notes`,
    payload: {
      checkpointId: "not-a-checkpoint",
      category: "other",
      body: "fallback note"
    },
    headers: { authorization: `Bearer ${crewChiefToken}` }
  });
  assert.equal(unknownCheckpoint.statusCode, 400);

  await app.close();
});
