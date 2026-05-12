import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";

function buildClaims(sub: string, teamIds: string[] = ["team-1"]) {
  return {
    sub,
    teamIds,
    roomRoles: {}
  };
}

async function setupPaidActiveRoom(
  app: ReturnType<typeof buildApp>,
  opts: { name: string; athleteId: string; creatorSub: string; creatorRole?: "athlete" | "team_manager" }
) {
  const creatorToken = app.jwt.sign(
    buildClaims(opts.creatorSub)
  );
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: opts.athleteId,
      name: opts.name,
      creatorRole: opts.creatorRole ?? "athlete"
    },
    headers: { authorization: `Bearer ${creatorToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${creatorToken}` }
  });

  await app.inject({
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
    headers: { authorization: `Bearer ${creatorToken}` }
  });

  return { roomId, creatorToken };
}

async function inviteAndAccept(
  app: ReturnType<typeof buildApp>,
  roomId: string,
  hostToken: string,
  inviteeEmail: string,
  role: "crew_member" | "crew_chief",
  inviteeToken: string
) {
  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: inviteeEmail, role },
    headers: { authorization: `Bearer ${hostToken}` }
  });
  assert.equal(issueResponse.statusCode, 201);
  const invite = issueResponse.json() as { token: string };
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: invite.token },
    headers: { authorization: `Bearer ${inviteeToken}` }
  });
}

test("team manager command board, metric config, heatmap, and authz", async () => {
  const app = buildApp();
  await app.ready();

  const managerToken = app.jwt.sign(buildClaims("tm-user"));
  const chiefToken = app.jwt.sign(buildClaims("chief-user"));
  const memberToken = app.jwt.sign(buildClaims("crew-member-user"));
  const athleteToken = app.jwt.sign(buildClaims("athlete-only"));

  const { roomId: roomA, creatorToken: hostA } = await setupPaidActiveRoom(app, {
    name: "WS6 Room A",
    athleteId: "ath-a",
    creatorSub: "tm-user",
    creatorRole: "team_manager"
  });

  await inviteAndAccept(app, roomA, hostA, "chief@example.com", "crew_chief", chiefToken);
  await inviteAndAccept(app, roomA, hostA, "member@example.com", "crew_member", memberToken);

  const { roomId: roomB, creatorToken: hostB } = await setupPaidActiveRoom(app, {
    name: "WS6 Room B",
    athleteId: "ath-b",
    creatorSub: "tm-user",
    creatorRole: "team_manager"
  });

  await inviteAndAccept(app, roomB, hostB, "chief-b@example.com", "crew_chief", chiefToken);
  await inviteAndAccept(app, roomB, hostB, "member-b@example.com", "crew_member", memberToken);

  const boardDenied = await app.inject({
    method: "GET",
    url: "/teams/team-1/command-center/board",
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(boardDenied.statusCode, 403);

  const boardAthlete = await app.inject({
    method: "GET",
    url: "/teams/team-1/command-center/board",
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(boardAthlete.statusCode, 403);

  const boardOk = await app.inject({
    method: "GET",
    url: "/teams/team-1/command-center/board",
    headers: { authorization: `Bearer ${managerToken}` }
  });
  assert.equal(boardOk.statusCode, 200);
  const boardBody = boardOk.json() as {
    board: { cards: Array<{ roomId: string }>; metricConfig: { selectedMetrics: string[] } };
  };
  assert.equal(boardBody.board.cards.length, 2);
  assert.ok(boardBody.board.cards.some((c) => c.roomId === roomA));
  assert.ok(boardBody.board.cards.some((c) => c.roomId === roomB));
  assert.equal(boardBody.board.metricConfig.selectedMetrics.length >= 1, true);

  const chiefBoard = await app.inject({
    method: "GET",
    url: "/teams/team-1/command-center/board",
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(chiefBoard.statusCode, 200);

  const putDenied = await app.inject({
    method: "PUT",
    url: "/teams/team-1/command-center/metric-config",
    payload: { selectedMetrics: ["sodium_per_hr"] },
    headers: { authorization: `Bearer ${chiefToken}` }
  });
  assert.equal(putDenied.statusCode, 403);

  const putOk = await app.inject({
    method: "PUT",
    url: "/teams/team-1/command-center/metric-config",
    payload: { selectedMetrics: ["electrolytes_per_hr", "sodium_per_hr"] },
    headers: { authorization: `Bearer ${managerToken}` }
  });
  assert.equal(putOk.statusCode, 200);
  const putBody = putOk.json() as { metricConfig: { selectedMetrics: string[] } };
  assert.deepEqual(putBody.metricConfig.selectedMetrics, ["electrolytes_per_hr", "sodium_per_hr"]);

  const heat = await app.inject({
    method: "GET",
    url: "/teams/team-1/command-center/checkpoint-heatmap",
    headers: { authorization: `Bearer ${managerToken}` }
  });
  assert.equal(heat.statusCode, 200);
  const heatBody = heat.json() as { heatmap: { cells: Array<{ concurrentRoomDemand: number }> } };
  assert.ok(heatBody.heatmap.cells.some((c) => c.concurrentRoomDemand >= 1));
});

test("staffing overlap when same assignee is in progress in two rooms", async () => {
  const app = buildApp();
  await app.ready();

  const managerToken = app.jwt.sign(buildClaims("tm-overlap"));
  const memberToken = app.jwt.sign(buildClaims("member-overlap"));

  const { roomId: r1 } = await setupPaidActiveRoom(app, {
    name: "Overlap 1",
    athleteId: "a1",
    creatorSub: "tm-overlap",
    creatorRole: "team_manager"
  });
  const { roomId: r2 } = await setupPaidActiveRoom(app, {
    name: "Overlap 2",
    athleteId: "a2",
    creatorSub: "tm-overlap",
    creatorRole: "team_manager"
  });

  await inviteAndAccept(app, r1, managerToken, "mo1@example.com", "crew_member", memberToken);
  await inviteAndAccept(app, r2, managerToken, "mo2@example.com", "crew_member", memberToken);

  const tasks1 = await app.inject({
    method: "GET",
    url: `/race-rooms/${r1}/tasks`,
    headers: { authorization: `Bearer ${managerToken}` }
  });
  const tasks2 = await app.inject({
    method: "GET",
    url: `/race-rooms/${r2}/tasks`,
    headers: { authorization: `Bearer ${managerToken}` }
  });
  const t1 = (tasks1.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;
  const t2 = (tasks2.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

  for (const [roomId, taskId] of [
    [r1, t1],
    [r2, t2]
  ] as const) {
    const assign = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/tasks/${taskId}/assign`,
      payload: { assigneeUserId: "member-overlap", assigneeRole: "crew_member" },
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert.equal(assign.statusCode, 200);
    const start = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${memberToken}` }
    });
    assert.equal(start.statusCode, 200);
  }

  const ov = await app.inject({
    method: "GET",
    url: "/teams/team-1/command-center/staffing-overlaps",
    headers: { authorization: `Bearer ${managerToken}` }
  });
  assert.equal(ov.statusCode, 200);
  const body = ov.json() as { overlaps: Array<{ assigneeUserId: string; roomIds: string[] }> };
  assert.equal(body.overlaps.length >= 1, true);
  const hit = body.overlaps.find((o) => o.assigneeUserId === "member-overlap");
  assert.ok(hit);
  assert.equal(hit!.roomIds.includes(r1) && hit!.roomIds.includes(r2), true);
});
