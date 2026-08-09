import test from "node:test";
import assert from "node:assert/strict";
import type { PlatformEventEnvelope } from "@crewcue/contracts";
import { matchesPlatformEventIdempotencyInput } from "./platformEventIdempotency.js";

const baseEvent: PlatformEventEnvelope = {
  id: "event-1",
  aggregateId: "room-1",
  aggregateType: "race_room",
  eventType: "race_room.draft_created",
  occurredAt: "2026-05-01T00:00:00.000Z",
  sequence: 1,
  idempotencyKey: "idem-1",
  payload: {
    name: "Race",
    athleteId: "athlete-1",
    nested: { b: 2, a: 1 },
    crew: [{ userId: "u2", role: "crew_member" }]
  },
  schemaVersion: "2026.05.0",
  transport: "cloud",
  actorUserId: "actor-1",
  correlationId: "corr-1",
  causationId: "cause-1"
};

test("platform event idempotency treats semantically equivalent payload objects as a match", () => {
  assert.equal(
    matchesPlatformEventIdempotencyInput(baseEvent, {
      aggregateId: "room-1",
      aggregateType: "race_room",
      eventType: "race_room.draft_created",
      idempotencyKey: "idem-1",
      normalizedPayload: {
        crew: [{ role: "crew_member", userId: "u2" }],
        nested: { a: 1, b: 2 },
        athleteId: "athlete-1",
        name: "Race"
      },
      schemaVersion: "2026.05.0",
      transport: "cloud",
      actorUserId: "actor-1",
      correlationId: "corr-1",
      causationId: "cause-1"
    }),
    true
  );
});

test("platform event idempotency rejects reuse when conflict-relevant metadata changes", () => {
  const matchingInput = {
    aggregateId: "room-1",
    aggregateType: "race_room" as const,
    eventType: "race_room.draft_created" as const,
    idempotencyKey: "idem-1",
    normalizedPayload: baseEvent.payload,
    schemaVersion: "2026.05.0",
    transport: "cloud" as const,
    actorUserId: "actor-1",
    correlationId: "corr-1",
    causationId: "cause-1"
  };

  const mismatches = [
    { name: "aggregate", input: { ...matchingInput, aggregateId: "room-2" } },
    { name: "event type", input: { ...matchingInput, eventType: "race_room.activated" as const } },
    { name: "schema version", input: { ...matchingInput, schemaVersion: "2026.06.0" } },
    { name: "actor", input: { ...matchingInput, actorUserId: "actor-2" } },
    { name: "correlation", input: { ...matchingInput, correlationId: "corr-2" } },
    { name: "causation", input: { ...matchingInput, causationId: "cause-2" } },
    {
      name: "payload",
      input: {
        ...matchingInput,
        normalizedPayload: { ...baseEvent.payload, name: "Different Race" }
      }
    }
  ];

  for (const mismatch of mismatches) {
    assert.equal(
      matchesPlatformEventIdempotencyInput(baseEvent, mismatch.input),
      false,
      mismatch.name
    );
  }
});
