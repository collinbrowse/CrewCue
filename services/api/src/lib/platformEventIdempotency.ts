import type { PlatformEventEnvelope, PlatformAggregateType, PlatformEventName, TransportChannel } from "@crewcue/contracts";

export type PlatformEventIdempotencyInput = {
  aggregateId: string;
  aggregateType: PlatformAggregateType;
  eventType: PlatformEventName;
  idempotencyKey: string;
  normalizedPayload: unknown;
  schemaVersion: string;
  transport: TransportChannel;
  actorUserId: string;
  correlationId?: string;
  causationId?: string;
};

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalizeJson(record[key])]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value)) ?? "undefined";
}

export function matchesPlatformEventIdempotencyInput(
  event: PlatformEventEnvelope,
  input: PlatformEventIdempotencyInput
): boolean {
  return (
    event.aggregateId === input.aggregateId &&
    event.aggregateType === input.aggregateType &&
    event.eventType === input.eventType &&
    event.idempotencyKey === input.idempotencyKey &&
    event.schemaVersion === input.schemaVersion &&
    event.transport === input.transport &&
    event.actorUserId === input.actorUserId &&
    (event.correlationId ?? undefined) === input.correlationId &&
    (event.causationId ?? undefined) === input.causationId &&
    stableJson(event.payload) === stableJson(input.normalizedPayload)
  );
}
