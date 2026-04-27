import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import type { PlatformEventEnvelope, ReplayedRaceRoomAggregate } from "@crewcue/contracts";
import { initRoomPersistence } from "./roomPersistence.js";
import {
  appendPlatformEvent,
  reduceRaceRoomEvents,
  resetPlatformEventStoreForTests
} from "./platformEventLog.js";

const testLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLog
} as unknown as FastifyBaseLogger;

test("append is idempotent by idempotencyKey", async () => {
  await initRoomPersistence(testLog);
  await resetPlatformEventStoreForTests();
  const first = await appendPlatformEvent({
    aggregateId: "room-a",
    aggregateType: "race_room",
    eventType: "race_room.draft_created",
    idempotencyKey: "idem-1",
    payload: { teamId: "t1", athleteId: "a1", name: "Race" },
    schemaVersion: "2026.05.0",
    transport: "cloud",
    actorUserId: "u1"
  });
  assert.equal(first.duplicate, false);
  const second = await appendPlatformEvent({
    aggregateId: "room-a",
    aggregateType: "race_room",
    eventType: "race_room.draft_created",
    idempotencyKey: "idem-1",
    payload: { teamId: "t1", athleteId: "a1", name: "Race" },
    schemaVersion: "2026.05.0",
    transport: "cloud",
    actorUserId: "u1"
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.event.id, first.event.id);
});

test("race_room replay is deterministic and order-insensitive for sequence sort", () => {
  const events: PlatformEventEnvelope[] = [
    {
      id: "1",
      aggregateId: "r1",
      aggregateType: "race_room",
      eventType: "race_room.draft_created",
      occurredAt: "2026-05-01T00:00:00.000Z",
      sequence: 1,
      idempotencyKey: "a",
      payload: { teamId: "t", athleteId: "ath", name: "Ultra" },
      schemaVersion: "2026.05.0",
      transport: "cloud",
      actorUserId: "x"
    },
    {
      id: "2",
      aggregateId: "r1",
      aggregateType: "race_room",
      eventType: "race_room.activated",
      occurredAt: "2026-05-01T00:01:00.000Z",
      sequence: 3,
      idempotencyKey: "c",
      payload: { eventEndsAt: "2026-05-02T00:00:00.000Z" },
      schemaVersion: "2026.05.0",
      transport: "cloud",
      actorUserId: "x"
    },
    {
      id: "3",
      aggregateId: "r1",
      aggregateType: "race_room",
      eventType: "plan_version.recorded",
      occurredAt: "2026-05-01T00:00:30.000Z",
      sequence: 2,
      idempotencyKey: "b",
      payload: { version: 2, planVersionId: "pv-2", rationale: "adjust" },
      schemaVersion: "2026.05.0",
      transport: "cloud",
      actorUserId: "x"
    }
  ];

  const shuffled = reduceRaceRoomEvents([events[1]!, events[2]!, events[0]!]);
  assert.equal(shuffled.status, "active");
  assert.equal(shuffled.name, "Ultra");
  assert.equal(shuffled.lastPlanVersion, 2);
  assert.equal(shuffled.lastActivatedEventEndsAt, "2026-05-02T00:00:00.000Z");
});

test("race_room replay can continue from an existing snapshot", () => {
  const base: ReplayedRaceRoomAggregate = {
    aggregateId: "r1",
    teamId: "t",
    athleteId: "ath",
    name: "Ultra",
    status: "draft",
    lastPlanVersion: 1
  };
  const events: PlatformEventEnvelope[] = [
    {
      id: "2",
      aggregateId: "r1",
      aggregateType: "race_room",
      eventType: "race_room.activated",
      occurredAt: "2026-05-01T00:01:00.000Z",
      sequence: 2,
      idempotencyKey: "b",
      payload: { eventEndsAt: "2026-05-02T00:00:00.000Z" },
      schemaVersion: "2026.05.0",
      transport: "cloud",
      actorUserId: "x"
    },
    {
      id: "3",
      aggregateId: "r1",
      aggregateType: "race_room",
      eventType: "plan_version.recorded",
      occurredAt: "2026-05-01T00:02:00.000Z",
      sequence: 3,
      idempotencyKey: "c",
      payload: { version: 3, planVersionId: "pv-3", rationale: "adjust" },
      schemaVersion: "2026.05.0",
      transport: "cloud",
      actorUserId: "x"
    }
  ];

  const continued = reduceRaceRoomEvents(events, base);
  assert.equal(continued.aggregateId, "r1");
  assert.equal(continued.teamId, "t");
  assert.equal(continued.name, "Ultra");
  assert.equal(continued.status, "active");
  assert.equal(continued.lastPlanVersion, 3);
  assert.equal(continued.lastActivatedEventEndsAt, "2026-05-02T00:00:00.000Z");
});

test("race_room replay uses provided fallback aggregateId for empty streams", () => {
  const reduced = reduceRaceRoomEvents([], undefined, "room-empty");
  assert.equal(reduced.aggregateId, "room-empty");
  assert.equal(reduced.status, "unknown");
});
