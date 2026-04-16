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

export function appendPlatformEvent(
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

export function listEventsForAggregate(
  aggregateType: PlatformAggregateType,
  aggregateId: string
): PlatformEventEnvelope[] {
  return store
    .filter((e) => e.aggregateType === aggregateType && e.aggregateId === aggregateId)
    .sort((a, b) => a.sequence - b.sequence);
}

export function reduceRaceRoomEvents(events: PlatformEventEnvelope[]): ReplayedRaceRoomAggregate {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const snap: ReplayedRaceRoomAggregate = {
    aggregateId: sorted[0]?.aggregateId ?? "",
    status: "unknown"
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

export function replayRaceRoomAggregate(aggregateId: string): ReplayedRaceRoomAggregate {
  const slice = listEventsForAggregate("race_room", aggregateId);
  return reduceRaceRoomEvents(slice);
}

export function resetPlatformEventStoreForTests(): void {
  store.length = 0;
  idempotencyIndex.clear();
  sequenceByAggregate.clear();
}
