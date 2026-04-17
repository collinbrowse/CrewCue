import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_SCHEMA_VERSION } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import { resetPlatformEventStoreForTests } from "../lib/platformEventLog.js";

function claims(sub: string) {
  return { sub, teamIds: ["team-1"], roomRoles: {} };
}

test("platform events append, list, replay with membership and idempotent retry", async () => {
  await resetPlatformEventStoreForTests();
  const app = buildApp();
  await app.ready();

  const athleteToken = app.jwt.sign(claims("athlete-user"));
  const outsiderToken = app.jwt.sign(claims("outsider"));

  const create = await app.inject({
    method: "POST",
    url: "/race-rooms",
    payload: {
      teamId: "team-1",
      athleteId: "athlete-user",
      name: "WS7 room",
      creatorRole: "athlete"
    },
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(create.statusCode, 201);
  const roomId = (create.json() as { id: string }).id;

  const denied = await app.inject({
    method: "POST",
    url: "/platform/v1/events",
    headers: { authorization: `Bearer ${outsiderToken}` },
    payload: {
      schemaVersion: PLATFORM_SCHEMA_VERSION,
      transport: "cloud",
      aggregateType: "race_room",
      aggregateId: roomId,
      eventType: "race_room.draft_created",
      idempotencyKey: "x1",
      payload: { teamId: "team-1", athleteId: "athlete-user", name: "WS7 room" }
    }
  });
  assert.equal(denied.statusCode, 403);

  const basePayload = {
    schemaVersion: PLATFORM_SCHEMA_VERSION,
    transport: "cloud" as const,
    aggregateType: "race_room" as const,
    aggregateId: roomId,
    eventType: "race_room.draft_created" as const,
    idempotencyKey: "evt-draft-1",
    payload: { teamId: "team-1", athleteId: "athlete-user", name: "WS7 room" }
  };

  const accepted = await app.inject({
    method: "POST",
    url: "/platform/v1/events",
    headers: { authorization: `Bearer ${athleteToken}` },
    payload: basePayload
  });
  assert.equal(accepted.statusCode, 202);
  const acceptedBody = accepted.json() as { duplicate: boolean; event: { id: string; sequence: number } };
  assert.equal(acceptedBody.duplicate, false);
  assert.equal(acceptedBody.event.sequence, 1);

  const dup = await app.inject({
    method: "POST",
    url: "/platform/v1/events",
    headers: { authorization: `Bearer ${athleteToken}` },
    payload: basePayload
  });
  assert.equal(dup.statusCode, 200);
  const dupBody = dup.json() as { duplicate: boolean; event: { id: string } };
  assert.equal(dupBody.duplicate, true);
  assert.equal(dupBody.event.id, acceptedBody.event.id);

  await app.inject({
    method: "POST",
    url: "/platform/v1/events",
    headers: { authorization: `Bearer ${athleteToken}` },
    payload: {
      schemaVersion: PLATFORM_SCHEMA_VERSION,
      transport: "cloud",
      aggregateType: "race_room",
      aggregateId: roomId,
      eventType: "race_room.activated",
      idempotencyKey: "evt-act-1",
      payload: { eventEndsAt: new Date(Date.now() + 86_400_000).toISOString() }
    }
  });

  const list = await app.inject({
    method: "GET",
    url: `/platform/v1/events?aggregateType=race_room&aggregateId=${encodeURIComponent(roomId)}`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(list.statusCode, 200);
  const listBody = list.json() as { events: Array<{ eventType: string }> };
  assert.equal(listBody.events.length, 2);

  const replay = await app.inject({
    method: "GET",
    url: `/platform/v1/aggregates/race_room/${roomId}/replay`,
    headers: { authorization: `Bearer ${athleteToken}` }
  });
  assert.equal(replay.statusCode, 200);
  const snap = (replay.json() as { snapshot: { status: string; name: string } }).snapshot;
  assert.equal(snap.status, "active");
  assert.equal(snap.name, "WS7 room");
});
