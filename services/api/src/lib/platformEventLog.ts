import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  PlanVersionRecordedPayload,
  PlatformAggregateType,
  PlatformEventEnvelope,
  PlatformEventName,
  RaceRoomActivatedPayload,
  RaceRoomDraftCreatedPayload,
  ReplayedRaceRoomAggregate,
  TransportChannel
} from "@crewcue/contracts";
import {
  appendPersistedPlatformEvent,
  isRoomPersistenceEnabled,
  loadRaceRoomSnapshot,
  listPersistedPlatformEventsForAggregate,
  persistRaceRoomSnapshot,
  resetPersistedPlatformEventsForTests as resetPersistedPlatformEventsInDbForTests
} from "./roomPersistence.js";

const draftSchema = z.object({
  teamId: z.string().min(1),
  athleteId: z.string().min(1),
  name: z.string().min(1)
}) satisfies z.ZodType<RaceRoomDraftCreatedPayload>;

const activatedSchema = z.object({
  eventEndsAt: z.iso.datetime()
}) satisfies z.ZodType<RaceRoomActivatedPayload>;

const planRecordedSchema = z.object({
  version: z.number().int().min(1),
  planVersionId: z.string().min(1),
  rationale: z.string().min(1)
}) satisfies z.ZodType<PlanVersionRecordedPayload>;

const passthroughPayload = z.record(z.string(), z.unknown());

export function coercePlatformEventPayload(eventType: PlatformEventName, payload: unknown): unknown {
  switch (eventType) {
    case "race_room.draft_created":
      return draftSchema.parse(payload);
    case "race_room.activated":
      return activatedSchema.parse(payload);
    case "plan_version.recorded":
      return planRecordedSchema.parse(payload);
    default:
      return passthroughPayload.parse(
        payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
      );
  }
}

const store: PlatformEventEnvelope[] = [];
const idempotencyIndex = new Map<string, PlatformEventEnvelope>();
const sequenceByAggregate = new Map<string, number>();

function aggregateKey(aggregateType: PlatformAggregateType, aggregateId: string): string {
  return `${aggregateType}:${aggregateId}`;
}

export type AppendPlatformEventInput = {
  aggregateId: string;
  aggregateType: PlatformAggregateType;
  eventType: PlatformEventName;
  idempotencyKey: string;
  payload: unknown;
  schemaVersion: string;
  transport: TransportChannel;
  actorUserId: string;
  correlationId?: string;
  causationId?: string;
};

function appendPlatformEventMemory(
  input: AppendPlatformEventInput
): { duplicate: true; event: PlatformEventEnvelope } | { duplicate: false; event: PlatformEventEnvelope } {
  const existing = idempotencyIndex.get(input.idempotencyKey);
  if (existing) {
    return { duplicate: true, event: existing };
  }

  const key = aggregateKey(input.aggregateType, input.aggregateId);
  const nextSeq = (sequenceByAggregate.get(key) ?? 0) + 1;
  sequenceByAggregate.set(key, nextSeq);

  const normalized = coercePlatformEventPayload(input.eventType, input.payload);

  const event: PlatformEventEnvelope = {
    id: randomUUID(),
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    sequence: nextSeq,
    idempotencyKey: input.idempotencyKey,
    payload: normalized,
    schemaVersion: input.schemaVersion,
    transport: input.transport,
    actorUserId: input.actorUserId,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {})
  };

  store.push(event);
  idempotencyIndex.set(input.idempotencyKey, event);
  return { duplicate: false, event };
}

export async function appendPlatformEvent(
  input: AppendPlatformEventInput
): Promise<{ duplicate: true; event: PlatformEventEnvelope } | { duplicate: false; event: PlatformEventEnvelope }> {
  if (!isRoomPersistenceEnabled()) {
    return appendPlatformEventMemory(input);
  }
  const normalized = coercePlatformEventPayload(input.eventType, input.payload);
  const result = await appendPersistedPlatformEvent({
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    normalizedPayload: normalized,
    schemaVersion: input.schemaVersion,
    transport: input.transport,
    actorUserId: input.actorUserId,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {})
  });
  if (!result.duplicate && input.aggregateType === "race_room") {
    await refreshRaceRoomSnapshot(input.aggregateId, result.event);
  }
  return result;
}

export async function listEventsForAggregate(
  aggregateType: PlatformAggregateType,
  aggregateId: string
): Promise<PlatformEventEnvelope[]> {
  if (!isRoomPersistenceEnabled()) {
    return store
      .filter((e) => e.aggregateType === aggregateType && e.aggregateId === aggregateId)
      .sort((a, b) => a.sequence - b.sequence);
  }
  return listPersistedPlatformEventsForAggregate(aggregateType, aggregateId);
}

export function reduceRaceRoomEvents(
  events: PlatformEventEnvelope[],
  base?: ReplayedRaceRoomAggregate,
  fallbackAggregateId?: string
): ReplayedRaceRoomAggregate {
  return reduceRaceRoomEventsOntoSnapshot(events, base, fallbackAggregateId);
}

function reduceRaceRoomEventsOntoSnapshot(
  events: PlatformEventEnvelope[],
  base?: ReplayedRaceRoomAggregate,
  fallbackAggregateId?: string
): ReplayedRaceRoomAggregate {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const snap: ReplayedRaceRoomAggregate = {
    aggregateId: base?.aggregateId ?? sorted[0]?.aggregateId ?? fallbackAggregateId ?? "",
    status: base?.status ?? "unknown",
    ...(base?.teamId !== undefined ? { teamId: base.teamId } : {}),
    ...(base?.athleteId !== undefined ? { athleteId: base.athleteId } : {}),
    ...(base?.name !== undefined ? { name: base.name } : {}),
    ...(base?.lastPlanVersion !== undefined ? { lastPlanVersion: base.lastPlanVersion } : {}),
    ...(base?.lastActivatedEventEndsAt !== undefined
      ? { lastActivatedEventEndsAt: base.lastActivatedEventEndsAt }
      : {})
  };

  for (const e of sorted) {
    switch (e.eventType) {
      case "race_room.draft_created": {
        const p = e.payload as RaceRoomDraftCreatedPayload;
        snap.teamId = p.teamId;
        snap.athleteId = p.athleteId;
        snap.name = p.name;
        snap.status = "draft";
        break;
      }
      case "race_room.activated": {
        const p = e.payload as RaceRoomActivatedPayload;
        snap.status = "active";
        snap.lastActivatedEventEndsAt = p.eventEndsAt;
        break;
      }
      case "race_room.completed": {
        snap.status = "completed";
        break;
      }
      case "plan_version.recorded": {
        const p = e.payload as PlanVersionRecordedPayload;
        const prev = snap.lastPlanVersion ?? 0;
        snap.lastPlanVersion = Math.max(prev, p.version);
        break;
      }
      default:
        break;
    }
  }

  return snap;
}

async function refreshRaceRoomSnapshot(
  aggregateId: string,
  appendedEvent?: PlatformEventEnvelope
): Promise<ReplayedRaceRoomAggregate> {
  const existing = await loadRaceRoomSnapshot(aggregateId);
  if (!existing && appendedEvent && appendedEvent.sequence === 1) {
    const reduced = reduceRaceRoomEventsOntoSnapshot([appendedEvent], undefined, aggregateId);
    await persistRaceRoomSnapshot({
      aggregateId,
      lastSequence: appendedEvent.sequence,
      payload: reduced
    });
    return reduced;
  }
  if (existing && appendedEvent && appendedEvent.sequence === existing.lastSequence + 1) {
    const reduced = reduceRaceRoomEventsOntoSnapshot([appendedEvent], existing.payload);
    await persistRaceRoomSnapshot({
      aggregateId,
      lastSequence: appendedEvent.sequence,
      payload: reduced
    });
    return reduced;
  }

  const slice = await listEventsForAggregate("race_room", aggregateId);
  if (existing) {
    const tail = slice.filter((event) => event.sequence > existing.lastSequence);
    if (tail.length === 0) {
      return existing.payload;
    }
    const reduced = reduceRaceRoomEventsOntoSnapshot(tail, existing.payload);
    await persistRaceRoomSnapshot({
      aggregateId,
      lastSequence: tail[tail.length - 1]!.sequence,
      payload: reduced
    });
    return reduced;
  }

  const reduced = reduceRaceRoomEventsOntoSnapshot(slice, undefined, aggregateId);
  const lastSequence = slice[slice.length - 1]?.sequence;
  if (lastSequence !== undefined) {
    await persistRaceRoomSnapshot({
      aggregateId,
      lastSequence,
      payload: reduced
    });
  }
  return reduced;
}

export async function replayRaceRoomAggregate(aggregateId: string): Promise<ReplayedRaceRoomAggregate> {
  return refreshRaceRoomSnapshot(aggregateId);
}

export async function resetPlatformEventStoreForTests(): Promise<void> {
  store.length = 0;
  idempotencyIndex.clear();
  sequenceByAggregate.clear();
  await resetPersistedPlatformEventsInDbForTests();
}
