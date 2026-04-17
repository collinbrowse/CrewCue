import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PLATFORM_SCHEMA_VERSION } from "@crewcue/contracts";
import {
  appendPlatformEvent,
  listEventsForAggregate,
  replayRaceRoomAggregate
} from "../lib/platformEventLog.js";
import { getRaceRoom } from "./raceRooms.js";

const AGGREGATES = [
  "team",
  "race_room",
  "athlete",
  "crew_member",
  "checkpoint",
  "task",
  "plan_version",
  "projection",
  "sync",
  "command_board"
] as const;

const EVENT_NAMES = [
  "race_room.draft_created",
  "race_room.activated",
  "race_room.completed",
  "membership.invited",
  "membership.accepted",
  "athlete_ping.accepted",
  "projection.recomputed",
  "task.created",
  "task.status_changed",
  "incident.recorded",
  "recommendation.decided",
  "plan_version.recorded",
  "sync.heartbeat_reported",
  "merge.recorded"
] as const;

const postEventBody = z.object({
  schemaVersion: z.literal(PLATFORM_SCHEMA_VERSION),
  transport: z.enum(["cloud", "ble"]),
  aggregateType: z.enum(AGGREGATES),
  aggregateId: z.string().min(1),
  eventType: z.enum(EVENT_NAMES),
  idempotencyKey: z.string().min(1),
  payload: z.unknown(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional()
});

async function assertRaceRoomMember(roomId: string, userId: string): Promise<{ ok: true } | { ok: false; code: 403 | 404 }> {
  const room = await getRaceRoom(roomId);
  if (!room) {
    return { ok: false, code: 404 };
  }
  const m = room.memberships.find((x) => x.userId === userId);
  if (!m) {
    return { ok: false, code: 403 };
  }
  return { ok: true };
}

export async function ws7PlatformRoutes(app: FastifyInstance): Promise<void> {
  app.post("/platform/v1/events", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = postEventBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid platform event payload" });
    }

    const body = parsed.data;
    if (body.aggregateType !== "race_room") {
      return reply.code(400).send({ error: "Sprint 1 only supports race_room aggregates" });
    }

    const gate = await assertRaceRoomMember(body.aggregateId, identity.sub);
    if (!gate.ok) {
      return reply.code(gate.code).send({ error: gate.code === 404 ? "Race room not found" : "Forbidden" });
    }

    const result = await appendPlatformEvent({
      aggregateId: body.aggregateId,
      aggregateType: body.aggregateType,
      eventType: body.eventType,
      idempotencyKey: body.idempotencyKey,
      payload: body.payload,
      schemaVersion: body.schemaVersion,
      transport: body.transport,
      actorUserId: identity.sub,
      ...(body.correlationId !== undefined ? { correlationId: body.correlationId } : {}),
      ...(body.causationId !== undefined ? { causationId: body.causationId } : {})
    });

    if (result.duplicate) {
      return reply.code(200).send({ event: result.event, duplicate: true });
    }
    return reply.code(202).send({ event: result.event, duplicate: false });
  });

  app.get("/platform/v1/events", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const q = request.query as { aggregateType?: string; aggregateId?: string };
    if (q.aggregateType !== "race_room" || !q.aggregateId) {
      return reply.code(400).send({ error: "aggregateType and aggregateId are required" });
    }

    const gate = await assertRaceRoomMember(q.aggregateId, identity.sub);
    if (!gate.ok) {
      return reply.code(gate.code).send({ error: gate.code === 404 ? "Race room not found" : "Forbidden" });
    }

    const events = await listEventsForAggregate("race_room", q.aggregateId);
    return reply.send({ events });
  });

  app.get("/platform/v1/aggregates/race_room/:aggregateId/replay", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const aggregateId = (request.params as { aggregateId: string }).aggregateId;
    const gate = await assertRaceRoomMember(aggregateId, identity.sub);
    if (!gate.ok) {
      return reply.code(gate.code).send({ error: gate.code === 404 ? "Race room not found" : "Forbidden" });
    }

    const snapshot = await replayRaceRoomAggregate(aggregateId);
    return reply.send({ snapshot });
  });
}
