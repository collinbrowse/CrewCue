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

async function setupPaidActiveRoomWithChief(app: ReturnType<typeof buildApp>) {
  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const chiefToken = app.jwt.sign(buildClaims("chief-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "WS4 Incidents",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });

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
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(activateResponse.statusCode, 200);

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "chief@example.com", role: "crew_chief" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(issueResponse.statusCode, 201);
  const invite = issueResponse.json() as { token: string };

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: invite.token },
    headers: { authorization: `Bearer ${chiefToken}` }
  });

  return { roomId, athleteToken, chiefToken };
}

test("incident → recommendation → accept produces plan versions and stable delta", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, athleteToken, chiefToken } = await setupPaidActiveRoomWithChief(app);

  const inc1 = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents`,
    payload: {
      category: "hydration",
      severity: "medium",
      checkpointId: "cp0",
      summary: "Bottle swap slower than planned"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(inc1.statusCode, 201);
  const incidentId1 = (inc1.json() as { incident: { id: string } }).incident.id;

  const gen1 = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents/${incidentId1}/recommendations`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(gen1.statusCode, 201);
  const rec1Id = (gen1.json() as { recommendation: { id: string } }).recommendation.id;

  const accept1 = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/recommendations/${rec1Id}/accept`,
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(accept1.statusCode, 200);

  const inc2 = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents`,
    payload: {
      category: "fuel",
      severity: "low",
      summary: "Gel packaging issue"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(inc2.statusCode, 201);
  const incidentId2 = (inc2.json() as { incident: { id: string } }).incident.id;

  const gen2 = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents/${incidentId2}/recommendations`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(gen2.statusCode, 201);
  const rec2Id = (gen2.json() as { recommendation: { id: string } }).recommendation.id;

  const accept2 = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/recommendations/${rec2Id}/accept`,
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(accept2.statusCode, 200);

  const versionsResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/plan-versions`,
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(versionsResponse.statusCode, 200);
  const versions = (versionsResponse.json() as { planVersions: Array<{ version: number }> }).planVersions;
  assert.equal(versions.length, 2);
  assert.deepEqual(
    versions.map((v) => v.version),
    [1, 2]
  );

  const deltaResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/plan-delta?fromVersion=1&toVersion=2`,
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(deltaResponse.statusCode, 200);
  const delta = (deltaResponse.json() as { planDelta: { fromVersion: number; toVersion: number; changes: string[] } })
    .planDelta;
  assert.equal(delta.fromVersion, 1);
  assert.equal(delta.toVersion, 2);
  assert.ok(delta.changes.length >= 3);

  await app.close();
});

test("reject path and duplicate recommendation guard", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, athleteToken, chiefToken } = await setupPaidActiveRoomWithChief(app);

  const inc = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents`,
    payload: { category: "other", severity: "high", summary: "Unexpected delay" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  const incidentId = (inc.json() as { incident: { id: string } }).incident.id;

  const gen = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents/${incidentId}/recommendations`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  const recId = (gen.json() as { recommendation: { id: string } }).recommendation.id;

  const dup = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents/${incidentId}/recommendations`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(dup.statusCode, 409);

  const reject = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/recommendations/${recId}/reject`,
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(reject.statusCode, 200);
  assert.equal((reject.json() as { recommendation: { status: string } }).recommendation.status, "rejected");

  await app.close();
});

test("forbids non-member and invalid checkpoint", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, athleteToken } = await setupPaidActiveRoomWithChief(app);
  const stranger = app.jwt.sign(buildClaims("stranger-user"));

  const denied = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/incidents`,
    headers: { authorization: `Bearer ${stranger}` }
  });
  assert.equal(denied.statusCode, 403);

  const badCp = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/incidents`,
    payload: {
      category: "fuel",
      severity: "low",
      checkpointId: "not-real",
      summary: "x"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(badCp.statusCode, 400);

  await app.close();
});
