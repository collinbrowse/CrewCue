import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../app.js";
import {
  lineStringRouteOverlayForCheckpoints,
  load50kCourseWithAids
} from "../lib/testCourseRouteLayer.js";
import type { RaceCourseCheckpoint, RaceRoom, WaypointTag } from "@crewcue/contracts";

const GOLDEN_CHECKPOINT_IDS = ["start", "aid-1", "aid-2", "aid-3", "finish"] as const;
const RACE_START_AT = "2026-08-15T13:00:00.000Z";

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

type TestApp = ReturnType<typeof buildApp>;

function checkpointById(room: RaceRoom, id: string): RaceCourseCheckpoint {
  const checkpoint = room.course?.checkpoints.find((row) => row.id === id);
  assert.ok(checkpoint, `missing checkpoint ${id}`);
  return checkpoint;
}

async function createPaidRoom(app: TestApp, ownerToken: string, name: string): Promise<string> {
  const createResponse = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-1",
      name,
      creatorRole: "team_manager"
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(createResponse.statusCode, 201);
  const roomId = (createResponse.json() as { id: string }).id;
  const entitlement = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/entitlement`,
    payload: { status: "paid" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(entitlement.statusCode, 200);
  return roomId;
}

async function put50kCourse(
  app: TestApp,
  roomId: string,
  ownerToken: string,
  checkpoints: RaceCourseCheckpoint[],
  headers: Record<string, string> = {}
) {
  const fixture = load50kCourseWithAids();
  return app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: fixture.plannedPaceSecondsPerKm,
      course: { checkpoints },
      routeOverlayLayer: fixture.routeOverlayLayer,
      raceStartAt: RACE_START_AT
    },
    headers: { authorization: `Bearer ${ownerToken}`, ...headers }
  });
}

function withTags(
  checkpoints: RaceCourseCheckpoint[],
  tagsById: Record<string, WaypointTag[] | undefined>
): RaceCourseCheckpoint[] {
  return checkpoints.map((checkpoint) => {
    if (!(checkpoint.id in tagsById)) {
      return checkpoint;
    }
    const tags = tagsById[checkpoint.id];
    if (tags === undefined) {
      const { tags: _omitted, ...rest } = checkpoint;
      return rest;
    }
    return { ...checkpoint, tags };
  });
}

test("EC1 omitted and empty tags persist as untagged landmarks", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec1"));
  const roomId = await createPaidRoom(app, ownerToken, "EC1 tags");
  const { checkpoints } = load50kCourseWithAids();
  assert.deepEqual(
    checkpoints.map((checkpoint) => checkpoint.id),
    [...GOLDEN_CHECKPOINT_IDS]
  );

  const putResponse = await put50kCourse(
    app,
    roomId,
    ownerToken,
    withTags(checkpoints, { "aid-1": [] })
  );
  assert.equal(putResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const room = (getResponse.json() as { room: RaceRoom }).room;
  const start = checkpointById(room, "start");
  const aid1 = checkpointById(room, "aid-1");
  assert.equal(start.tags, undefined);
  assert.deepEqual(aid1.tags, []);
  assert.equal(typeof start.latitude, "number");
  assert.equal(typeof start.longitude, "number");

  await app.close();
});

test("EC2 invalid tag strings are rejected with 400 and not persisted", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec2"));
  const roomId = await createPaidRoom(app, ownerToken, "EC2 invalid tags");
  const { checkpoints } = load50kCourseWithAids();

  for (const invalid of ["AID", "finish", "Aid"]) {
    const putResponse = await put50kCourse(
      app,
      roomId,
      ownerToken,
      withTags(checkpoints, { "aid-1": [invalid as WaypointTag] })
    );
    assert.equal(putResponse.statusCode, 400, `expected 400 for tag ${invalid}`);
  }

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const room = (getResponse.json() as { room: RaceRoom }).room;
  assert.equal(room.course, undefined);

  const patchMissingCourse = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/aid-1`,
    payload: { tags: ["AID"] },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(patchMissingCourse.statusCode, 400);

  await app.close();
});

test("EC3 unauthorized and wrong-role callers cannot mutate waypoints", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec3"));
  const strangerToken = app.jwt.sign(buildClaims("stranger-w11-ec3"));
  const crewToken = app.jwt.sign(buildClaims("crew-w11-ec3"));
  const roomId = await createPaidRoom(app, ownerToken, "EC3 authz");
  const { checkpoints } = load50kCourseWithAids();
  const putOk = await put50kCourse(
    app,
    roomId,
    ownerToken,
    withTags(checkpoints, { "aid-1": ["aid"] })
  );
  assert.equal(putOk.statusCode, 200);

  const invite = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites`,
    payload: { email: "crew@example.com", role: "crew_member" },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(invite.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/invites/accept`,
    payload: { token: (invite.json() as { token: string }).token },
    headers: { authorization: `Bearer ${crewToken}` }
  });
  assert.equal(accept.statusCode, 200);

  const patchBody = { tags: ["crew"] };
  const postBody = {
    id: "water-1",
    latitude: checkpoints[0]!.latitude,
    longitude: checkpoints[0]!.longitude,
    tags: ["water"]
  };

  const unauthPut = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      plannedPaceSecondsPerKm: 360,
      course: { checkpoints },
      raceStartAt: RACE_START_AT
    }
  });
  assert.equal(unauthPut.statusCode, 401);

  const unauthPatch = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/aid-1`,
    payload: patchBody
  });
  assert.equal(unauthPatch.statusCode, 401);

  const unauthPost = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints`,
    payload: postBody
  });
  assert.equal(unauthPost.statusCode, 401);

  const unauthDelete = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/aid-2`
  });
  assert.equal(unauthDelete.statusCode, 401);

  for (const token of [strangerToken, crewToken]) {
    const headers = { authorization: `Bearer ${token}` };
    const putDenied = await put50kCourse(app, roomId, token, checkpoints);
    assert.equal(putDenied.statusCode, 403);
    const patchDenied = await app.inject({
      method: "PATCH",
      url: `/race-rooms/${roomId}/checkpoints/aid-1`,
      payload: patchBody,
      headers
    });
    assert.equal(patchDenied.statusCode, 403);
    const postDenied = await app.inject({
      method: "POST",
      url: `/race-rooms/${roomId}/checkpoints`,
      payload: postBody,
      headers
    });
    assert.equal(postDenied.statusCode, 403);
    const deleteDenied = await app.inject({
      method: "DELETE",
      url: `/race-rooms/${roomId}/checkpoints/aid-2`,
      headers
    });
    assert.equal(deleteDenied.statusCode, 403);
  }

  await app.close();
});

test("EC4 and EC5 PUT course idempotency replay still works when tags are present", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec4"));
  const roomId = await createPaidRoom(app, ownerToken, "EC4 idempotent tags");
  const { checkpoints } = load50kCourseWithAids();
  const tagged = withTags(checkpoints, { "aid-1": ["aid", "crew"], "aid-2": ["water"] });
  const headers = {
    authorization: `Bearer ${ownerToken}`,
    "idempotency-key": "w11-put-course-tags-replay"
  };

  const first = await put50kCourse(app, roomId, ownerToken, tagged, {
    "idempotency-key": headers["idempotency-key"]
  });
  assert.equal(first.statusCode, 200);
  const firstRoom = first.json() as RaceRoom;
  assert.deepEqual(checkpointById(firstRoom, "aid-1").tags, ["aid", "crew"]);

  const replay = await put50kCourse(app, roomId, ownerToken, tagged, {
    "idempotency-key": headers["idempotency-key"]
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());

  await app.close();
});

test("EC6 tags do not change lat/lng or meter distances", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec6"));
  const roomId = await createPaidRoom(app, ownerToken, "EC6 units");
  const { checkpoints } = load50kCourseWithAids();

  const withoutTags = await put50kCourse(app, roomId, ownerToken, checkpoints);
  assert.equal(withoutTags.statusCode, 200);
  const baseline = withoutTags.json() as RaceRoom;
  const baselineAid = checkpointById(baseline, "aid-1");

  const withAidTag = await put50kCourse(
    app,
    roomId,
    ownerToken,
    withTags(checkpoints, { "aid-1": ["aid"] })
  );
  assert.equal(withAidTag.statusCode, 200);
  const tagged = withAidTag.json() as RaceRoom;
  const taggedAid = checkpointById(tagged, "aid-1");

  assert.equal(taggedAid.latitude, baselineAid.latitude);
  assert.equal(taggedAid.longitude, baselineAid.longitude);
  assert.equal(taggedAid.distanceMetersFromStart, baselineAid.distanceMetersFromStart);
  assert.equal(typeof taggedAid.distanceMetersFromStart, "number");
  assert.ok((taggedAid.distanceMetersFromStart ?? 0) >= 0);
  assert.deepEqual(taggedAid.tags, ["aid"]);
  assert.equal(tagged.course?.derivedMetrics?.canonicalDistanceMeters, baseline.course?.derivedMetrics?.canonicalDistanceMeters);

  await app.close();
});

test("EC7 multiple tags on one waypoint round-trip through GET", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec7"));
  const roomId = await createPaidRoom(app, ownerToken, "EC7 multi-tag");
  const { checkpoints } = load50kCourseWithAids();

  const putResponse = await put50kCourse(
    app,
    roomId,
    ownerToken,
    withTags(checkpoints, { "aid-2": ["aid", "crew"] })
  );
  assert.equal(putResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(getResponse.statusCode, 200);
  const room = (getResponse.json() as { room: RaceRoom }).room;
  assert.deepEqual(checkpointById(room, "aid-2").tags, ["aid", "crew"]);

  const patched = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/aid-2`,
    payload: { title: "Crew aid", tags: ["aid", "dropbag", "crew"] },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(patched.statusCode, 200);
  const patchedRoom = patched.json() as RaceRoom;
  const aid2 = checkpointById(patchedRoom, "aid-2");
  assert.equal(aid2.title, "Crew aid");
  assert.deepEqual(aid2.tags, ["aid", "dropbag", "crew"]);

  await app.close();
});

test("EC8 delete visited checkpoint returns 400 and leaves course unchanged", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec8"));
  const roomId = await createPaidRoom(app, ownerToken, "EC8 visited delete");

  const activate = await app.inject({
    method: "PUT",
    url: `/race-rooms/${roomId}/course`,
    payload: {
      course: {
        checkpoints: [
          { id: "cp0", latitude: 41.0, longitude: -71.0, tags: ["aid"] },
          { id: "cp1", latitude: 41.01, longitude: -71.0, tags: ["water"] }
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
  assert.equal(activate.statusCode, 200);
  const before = activate.json() as RaceRoom;
  const activatedAtMs = Date.parse(before.activatedAt ?? "");

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

  const deleted = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/cp0`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(deleted.statusCode, 400);
  assert.match((deleted.json() as { error: string }).error, /visited checkpoint: cp0/);

  const getResponse = await app.inject({
    method: "GET",
    url: `/race-rooms/${roomId}`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  const after = (getResponse.json() as { room: RaceRoom }).room;
  assert.deepEqual(
    after.course?.checkpoints.map((checkpoint) => checkpoint.id),
    before.course?.checkpoints.map((checkpoint) => checkpoint.id)
  );
  assert.deepEqual(checkpointById(after, "cp0").tags, ["aid"]);

  await app.close();
});

test("EC9 PATCH unknown checkpoint returns 404", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-ec9"));
  const roomId = await createPaidRoom(app, ownerToken, "EC9 patch 404");
  const { checkpoints } = load50kCourseWithAids();
  const putResponse = await put50kCourse(app, roomId, ownerToken, checkpoints);
  assert.equal(putResponse.statusCode, 200);

  const missing = await app.inject({
    method: "PATCH",
    url: `/race-rooms/${roomId}/checkpoints/not-a-real-id`,
    payload: { tags: ["crew"] },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(missing.statusCode, 404);

  const deleteMissing = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/not-a-real-id`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(deleteMissing.statusCode, 404);

  await app.close();
});

test("POST adds a tagged waypoint and DELETE removes an unvisited one", async () => {
  const app = buildApp();
  await app.ready();
  const ownerToken = app.jwt.sign(buildClaims("owner-w11-crud"));
  const roomId = await createPaidRoom(app, ownerToken, "waypoint CRUD");
  const { checkpoints } = load50kCourseWithAids();
  const putResponse = await put50kCourse(
    app,
    roomId,
    ownerToken,
    withTags(checkpoints, { "aid-1": ["aid"] })
  );
  assert.equal(putResponse.statusCode, 200);
  const finish = checkpointById(putResponse.json() as RaceRoom, "finish");

  const noCourseRoomId = await createPaidRoom(app, ownerToken, "no course yet");
  const postNoCourse = await app.inject({
    method: "POST",
    url: `/race-rooms/${noCourseRoomId}/checkpoints`,
    payload: {
      id: "water-1",
      latitude: finish.latitude,
      longitude: finish.longitude,
      tags: ["water"]
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(postNoCourse.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints`,
    payload: {
      id: "water-1",
      title: "Stream crossing",
      latitude: finish.latitude,
      longitude: finish.longitude,
      tags: ["water"]
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(created.statusCode, 201);
  const createdRoom = created.json() as RaceRoom;
  const water = checkpointById(createdRoom, "water-1");
  assert.equal(water.title, "Stream crossing");
  assert.deepEqual(water.tags, ["water"]);
  assert.equal(typeof water.distanceMetersFromStart, "number");
  assert.ok(createdRoom.course?.checkpoints.some((checkpoint) => checkpoint.id === "aid-1"));

  const duplicate = await app.inject({
    method: "POST",
    url: `/race-rooms/${roomId}/checkpoints`,
    payload: {
      id: "water-1",
      latitude: finish.latitude,
      longitude: finish.longitude
    },
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(duplicate.statusCode, 400);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/race-rooms/${roomId}/checkpoints/aid-3`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(deleted.statusCode, 200);
  const afterDelete = deleted.json() as RaceRoom;
  assert.equal(
    afterDelete.course?.checkpoints.some((checkpoint) => checkpoint.id === "aid-3"),
    false
  );
  assert.ok(afterDelete.course?.checkpoints.some((checkpoint) => checkpoint.id === "start"));
  assert.ok(afterDelete.course?.checkpoints.some((checkpoint) => checkpoint.id === "water-1"));

  await app.close();
});
