import test from "node:test";
import assert from "node:assert/strict";
import type { RaceRoomProjection } from "@crewcue/contracts";
import { checkpointsWithProjectedDistances } from "@crewcue/map-core";
import { buildApp } from "../app.js";
import { lineStringRouteOverlayForCheckpoints } from "../lib/testCourseRouteLayer.js";
import { cumulativeDistanceAtCheckpoints } from "../lib/raceProjection.js";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

test("returns projection after accepted ping and from GET", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Proj Room",
      creatorRole: "team_manager"
    },
    headers: {
      authorization: `Bearer ${ownerToken}`
    }
  });
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
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(activateResponse.statusCode, 200);

  const recordedAt = new Date().toISOString();
  const pingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.005,
      longitude: -70.0,
      recordedAt
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(pingResponse.statusCode, 201);
  const pingBody = pingResponse.json() as { projection?: RaceRoomProjection };
  assert.ok(pingBody.projection);
  assert.equal(pingBody.projection.roomId, roomId);
  assert.ok(pingBody.projection.progressMeters > 0);
  assert.ok(pingBody.projection.weatherStub);
  assert.equal(pingBody.projection.weatherStub?.source, "stub");
  assert.equal(pingBody.projection.projectionConfidence, "fresh");
  assert.equal(pingBody.projection.stalenessThresholdSeconds, 900);
  assert.ok(pingBody.projection.secondsSinceLastAcceptedPing >= 0);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const getBody = getResponse.json() as RaceRoomProjection;
  assert.equal(getBody.asOfPingId, pingBody.projection!.asOfPingId);
  assert.equal(getBody.progressMeters, pingBody.projection!.progressMeters);
  assert.equal(getBody.projectionConfidence, "fresh");

  await app.close();
});

test("GET projection exposes derived staleness threshold from uploadIntervalSeconds", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Interval staleness",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 45.0, longitude: -67.0 },
          { id: "cp1", latitude: 45.01, longitude: -67.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 45.0, longitude: -67.0 },
        { latitude: 45.01, longitude: -67.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 45.005,
      longitude: -67.0,
      recordedAt: new Date().toISOString(),
      uploadIntervalSeconds: 40
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const body = getResponse.json() as RaceRoomProjection;
  assert.equal(body.stalenessThresholdSeconds, 120);
  assert.equal(body.projectionConfidence, "fresh");

  await app.close();
});

test("GET projection becomes degraded after silence beyond threshold", async (t) => {
  const prev = process.env.PROJECTION_STALE_AFTER_SECONDS;
  t.after(() => {
    if (prev === undefined) {
      delete process.env.PROJECTION_STALE_AFTER_SECONDS;
    } else {
      process.env.PROJECTION_STALE_AFTER_SECONDS = prev;
    }
  });
  process.env.PROJECTION_STALE_AFTER_SECONDS = "1";

  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Stale proj",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 43.0, longitude: -69.0 },
          { id: "cp1", latitude: 43.01, longitude: -69.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 43.0, longitude: -69.0 },
        { latitude: 43.01, longitude: -69.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const recordedAt = new Date().toISOString();
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: { latitude: 43.005, longitude: -69.0, recordedAt },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  await new Promise((r) => setTimeout(r, 1100));

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const body = getResponse.json() as RaceRoomProjection;
  assert.equal(body.projectionConfidence, "degraded");
  assert.equal(body.stalenessThresholdSeconds, 1);
  assert.ok(body.secondsSinceLastAcceptedPing >= 1);

  await app.close();
});

test("projection uses baseline track payloads and keeps ETA anchored within a checkpoint segment", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const checkpoints = [
    { id: "cp0", latitude: 42.0, longitude: -70.0 },
    { id: "cp1", latitude: 42.01, longitude: -70.0 },
    { id: "cp2", latitude: 42.02, longitude: -70.0 }
  ];
  const routeMetricPoints = checkpoints.map((c) => ({ latitude: c.latitude, longitude: c.longitude }));
  const projectedCheckpoints = checkpointsWithProjectedDistances(checkpoints, routeMetricPoints);
  const cum = cumulativeDistanceAtCheckpoints(projectedCheckpoints);

  const raceStartMs = Date.now() - 115_000;
  const raceStartAt = new Date(raceStartMs).toISOString();
  const recordedAt1 = new Date(raceStartMs + 40_000).toISOString();
  const recordedAt2 = new Date(raceStartMs + 100_000).toISOString();
  const recordedAt3 = new Date(raceStartMs + 120_000).toISOString();

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Baseline projection",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
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
        checkpoints,
        baselineTrack: {
          points: [
            { distanceMetersFromStart: 0, referenceElapsedSeconds: 0 },
            { distanceMetersFromStart: cum[1]!, referenceElapsedSeconds: 30 },
            { distanceMetersFromStart: cum[2]!, referenceElapsedSeconds: 90 }
          ]
        }
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 42.0, longitude: -70.0 },
        { latitude: 42.01, longitude: -70.0 },
        { latitude: 42.02, longitude: -70.0 }
      ]),
      plannedPaceSecondsPerKm: 1200,
      raceStartAt
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(activateResponse.statusCode, 200);
  const activatedAt = (activateResponse.json() as { activatedAt: string }).activatedAt;
  const activatedAtMs = Date.parse(activatedAt);

  const checkpointPingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: checkpoints[1]!.latitude,
      longitude: checkpoints[1]!.longitude,
      recordedAt: recordedAt1
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(checkpointPingResponse.statusCode, 201);

  const midSegmentPingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.015,
      longitude: -70.0,
      recordedAt: recordedAt2
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(midSegmentPingResponse.statusCode, 201);
  const midSegmentBody = midSegmentPingResponse.json() as { projection?: RaceRoomProjection };
  assert.ok(midSegmentBody.projection);
  assert.equal(midSegmentBody.projection.checkpointSplits[1]?.plannedElapsedSecondsAtCross, 30);
  assert.equal(midSegmentBody.projection.checkpointSplits[2]?.plannedElapsedSecondsAtCross, 90);
  assert.equal(midSegmentBody.projection.checkpointSplits[1]?.actualElapsedSecondsAtCross, 40);
  assert.equal(
    midSegmentBody.projection.etaFinishPlanIso,
    new Date(activatedAtMs + 100_000).toISOString()
  );

  const laterSegmentPingResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 42.0155,
      longitude: -70.0,
      recordedAt: recordedAt3
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(laterSegmentPingResponse.statusCode, 201);
  const laterSegmentBody = laterSegmentPingResponse.json() as { projection?: RaceRoomProjection };
  assert.ok(laterSegmentBody.projection);
  assert.ok(
    laterSegmentBody.projection.progressMeters > midSegmentBody.projection!.progressMeters,
    "progress should keep moving inside the anchored ETA segment"
  );

  await app.close();
});

test("GET projection returns 403 for non-member", async () => {
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
      name: "Members only proj",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 44.0, longitude: -68.0 },
          { id: "cp1", latitude: 44.01, longitude: -68.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 44.0, longitude: -68.0 },
        { latitude: 44.01, longitude: -68.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 44.005,
      longitude: -68.0,
      recordedAt: new Date().toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${strangerToken}` }
  });
  assert.equal(getResponse.statusCode, 403);

  await app.close();
});

test("GET projection returns checkpointSplits after course save without any ping", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "No ping",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
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
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const body = getResponse.json() as RaceRoomProjection;
  assert.equal(body.checkpointSplits.length, 2);
  assert.equal(body.asOfPingId, "bootstrap");

  await app.close();
});

test("manual checkpoint stop updates projection split as manual source", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Manual stop room",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
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
          { id: "cp0", latitude: 40.0, longitude: -70.0, plannedStopSeconds: 180, stoppageRadiusMeters: 1000 },
          { id: "cp1", latitude: 40.01, longitude: -70.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 40.0, longitude: -70.0 },
        { latitude: 40.01, longitude: -70.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const activatedAt = (activateResponse.json() as { activatedAt: string }).activatedAt;
  const activatedAtMs = Date.parse(activatedAt);
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.0,
      longitude: -70.0,
      recordedAt: new Date(activatedAtMs + 60_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 40.00001,
      longitude: -70.0,
      recordedAt: new Date(activatedAtMs + 120_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const manual = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/cp0/manual-stop`,
    payload: {
      arrivalAt: new Date(activatedAtMs + 70_000).toISOString(),
      departureAt: new Date(activatedAtMs + 250_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(manual.statusCode, 200);
  const manualSplit = manual.json() as { checkpointSplit: RaceRoomProjection["checkpointSplits"][number] };
  assert.equal(manualSplit.checkpointSplit.visits[0]?.resolvedSource, "manual_crew");
  assert.equal(manualSplit.checkpointSplit.visits[0]?.activeActualStopSeconds, 180);
  const viewResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}/projection`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(viewResponse.statusCode, 200);
  const projection = viewResponse.json() as RaceRoomProjection;
  const cp0 = projection.checkpointSplits.find((row) => row.checkpointId === "cp0");
  assert.ok(cp0);
  assert.equal(cp0?.visits[0]?.resolvedSource, "manual_crew");
  assert.equal(cp0?.visits[0]?.activeActualStopSeconds, 180);
  assert.equal(projection.stoppageSummary.totalActualStopSeconds, 180);
  await app.close();
});

test("athlete cannot mutate checkpoint stoppage timing endpoints", async () => {
  const app = buildApp();
  await app.ready();
  const athleteToken = app.jwt.sign(buildClaims("athlete-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Athlete timing room",
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
  const activateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 41.0, longitude: -71.0, plannedStopSeconds: 60, stoppageRadiusMeters: 1000 },
          { id: "cp1", latitude: 41.01, longitude: -71.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 41.0, longitude: -71.0 },
        { latitude: 41.01, longitude: -71.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  const activatedAt = (activateResponse.json() as { activatedAt: string }).activatedAt;
  const activatedAtMs = Date.parse(activatedAt);
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 41.0,
      longitude: -71.0,
      recordedAt: new Date(activatedAtMs + 60_000).toISOString()
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });

  const manual = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/cp0/manual-stop`,
    payload: {
      arrivalAt: new Date(activatedAtMs + 70_000).toISOString(),
      departureAt: new Date(activatedAtMs + 250_000).toISOString()
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(manual.statusCode, 403);

  const patch = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/cp0/visits/1/resolved-source`,
    payload: { resolvedSource: "manual_crew" },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(patch.statusCode, 403);

  await app.close();
});

test("crew member can mutate checkpoint stoppage timing after invite acceptance", async () => {
  const app = buildApp();
  await app.ready();
  const managerToken = app.jwt.sign(buildClaims("manager-user"));
  const crewToken = app.jwt.sign(buildClaims("crew-user"));

  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Crew timing room",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${managerToken}` }
  });
  const roomId = (createResponse.json() as { id: string }).id;

  const inviteResponse = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: {
      email: "crew.member@example.com",
      role: "crew_member"
    },
    headers: { authorization: `Bearer ${managerToken}` }
  });
  assert.equal(inviteResponse.statusCode, 201);
  const inviteToken = (inviteResponse.json() as { token: string }).token;

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: inviteToken },
    headers: { authorization: `Bearer ${crewToken}` }
  });

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${managerToken}` }
  });

  const activateResponse = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 50.0, longitude: -60.0, plannedStopSeconds: 120, stoppageRadiusMeters: 1000 },
          { id: "cp1", latitude: 50.01, longitude: -60.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 50.0, longitude: -60.0 },
        { latitude: 50.01, longitude: -60.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${managerToken}` }
  });
  const activatedAt = (activateResponse.json() as { activatedAt: string }).activatedAt;
  const activatedAtMs = Date.parse(activatedAt);

  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 50.0,
      longitude: -60.0,
      recordedAt: new Date(activatedAtMs + 60_000).toISOString()
    },
    headers: { authorization: `Bearer ${managerToken}` }
  });

  const manual = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/cp0/manual-stop`,
    payload: {
      arrivalAt: new Date(activatedAtMs + 70_000).toISOString(),
      departureAt: new Date(activatedAtMs + 250_000).toISOString()
    },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(manual.statusCode, 200);

  await app.close();
});

test("resolved source toggle rejects impossible selections", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-user"));
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name: "Resolved source validation",
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
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
          { id: "cp0", latitude: 39.0, longitude: -75.0, plannedStopSeconds: 30, stoppageRadiusMeters: 2000 },
          { id: "cp1", latitude: 39.01, longitude: -75.0 }
        ]
      },
      routeOverlayLayer: lineStringRouteOverlayForCheckpoints([
        { latitude: 39.0, longitude: -75.0 },
        { latitude: 39.01, longitude: -75.0 }
      ]),
      plannedPaceSecondsPerKm: 720,
      raceStartAt: "2026-05-12T16:00:00.000Z"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const activatedAt = (activateResponse.json() as { activatedAt: string }).activatedAt;
  const activatedAtMs = Date.parse(activatedAt);
  await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/pings`,
    payload: {
      latitude: 39.0,
      longitude: -75.0,
      recordedAt: new Date(activatedAtMs + 60_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  const manualOnly = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints/cp0/manual-stop`,
    payload: {
      arrivalAt: new Date(activatedAtMs + 70_000).toISOString(),
      departureAt: new Date(activatedAtMs + 250_000).toISOString()
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(manualOnly.statusCode, 200);

  const badAuto = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/cp0/visits/1/resolved-source`,
    payload: { resolvedSource: "auto" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(badAuto.statusCode, 400);

  const badVisitIndex = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/cp0/visits/not-a-number/resolved-source`,
    payload: { resolvedSource: "manual_crew" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(badVisitIndex.statusCode, 400);

  await app.close();
});
