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

async function setupPaidActiveRoom(app: ReturnType<typeof buildApp>) {
  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));
  const memberToken = app.jwt.sign(buildClaims("member-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "WS5 Sync",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${athleteToken}` }
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
    headers: { authorization: `Bearer ${athleteToken}` }
  });

  const issueResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "m@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  const invite = issueResponse.json() as { token: string };
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: invite.token },
    headers: { authorization: `Bearer ${memberToken}` }
  });

  return { roomId, athleteToken, memberToken };
}

test("heartbeat, health stale transition, queue diagnostics, merge telemetry", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, athleteToken, memberToken } = await setupPaidActiveRoom(app);

  const hb = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/sync/heartbeat`,
    payload: { deviceId: "iphone-1", pendingQueueCount: 3 },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(hb.statusCode, 200);

  const healthFresh = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/sync/health?staleAfterSeconds=600`,
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(healthFresh.statusCode, 200);
  const freshBody = healthFresh.json() as { syncStatus: { devices: Array<{ isStale: boolean }> } };
  assert.equal(freshBody.syncStatus.devices.length, 1);
  assert.equal(freshBody.syncStatus.devices[0]!.isStale, false);

  await new Promise((r) => setTimeout(r, 25));

  const healthStale = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/sync/health?staleAfterSeconds=0`,
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(healthStale.statusCode, 200);
  const staleBody = healthStale.json() as { syncStatus: { devices: Array<{ isStale: boolean }> } };
  assert.equal(staleBody.syncStatus.devices[0]!.isStale, true);

  const diagPost = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/sync/queue-diagnostics`,
    payload: { deviceId: "iphone-1", pendingByOpType: { ping: 1, task: 2 } },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(diagPost.statusCode, 201);

  const diagList = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/sync/queue-diagnostics`,
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(diagList.statusCode, 200);
  const listed = diagList.json() as { diagnostics: Array<{ pendingByOpType: Record<string, number> }> };
  assert.ok(listed.diagnostics.length >= 1);

  const mergeDenied = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/sync/merge-records`,
    payload: {
      deviceId: "iphone-1",
      conflictKey: "task-42",
      strategy: "manual",
      notes: "picked athlete copy"
    },
    headers: { authorization: `Bearer ${memberToken}` }
  });
  assert.equal(mergeDenied.statusCode, 403);

  const mergeOk = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/sync/merge-records`,
    payload: {
      deviceId: "iphone-1",
      conflictKey: "task-42",
      strategy: "manual"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(mergeOk.statusCode, 201);

  const mergeList = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/sync/merge-records`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(mergeList.statusCode, 200);
  const merges = mergeList.json() as { mergeRecords: Array<{ conflictKey: string }> };
  assert.ok(merges.mergeRecords.some((m) => m.conflictKey === "task-42"));

  await app.close();
});

test("returns 403 for non-member on sync reads", async () => {
  const app = buildApp();
  await app.ready();

  const { roomId, athleteToken } = await setupPaidActiveRoom(app);
  const stranger = app.jwt.sign(buildClaims("stranger-user"));

  const denied = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/sync/health`,
    headers: { authorization: `Bearer ${stranger}` }
  });
  assert.equal(denied.statusCode, 403);

  const ok = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/sync/health`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(ok.statusCode, 200);

  await app.close();
});
