import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RaceRoom, RaceRoomStopPlan, StopPlanNote } from "@crewcue/contracts";
import {
  beginIdempotentMutation,
  completeIdempotentMutation,
  idempotencyErrorReply,
  releaseIdempotentMutation
} from "../lib/httpIdempotency.js";
import { evaluateEntitlement, getRaceRoom, requireCourseEditor, saveRaceRoom } from "./raceRooms.js";

/**
 * Empty note `body` (including whitespace-only) clears that notes field rather than 400.
 * Callers that need to reject empty text should validate client-side before upsert.
 */
const stopPlanNoteInput = z
  .object({
    id: z.string().min(1).optional(),
    body: z.string()
  })
  .strict();

const upsertStopPlanInput = z
  .object({
    delayOverrideSeconds: z.number().finite().nonnegative().nullable().optional(),
    athleteNotes: stopPlanNoteInput.nullable().optional(),
    planNotes: stopPlanNoteInput.nullable().optional()
  })
  .strict();

type UpsertStopPlanInput = z.infer<typeof upsertStopPlanInput>;

type StopPlanResponse = {
  roomId: string;
  checkpointId: string;
  delayOverrideSeconds?: number;
  athleteNotes?: StopPlanNote;
  planNotes?: StopPlanNote;
};

async function requireRoomMember(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  roomId: string
): Promise<RaceRoom | undefined> {
  if (!request.identity) {
    await reply.code(401).send({ error: "Unauthorized" });
    return undefined;
  }
  const room = await getRaceRoom(roomId);
  if (!room) {
    await reply.code(404).send({ error: "Race room not found" });
    return undefined;
  }
  const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
  if (!membership) {
    await reply.code(403).send({ error: "Forbidden" });
    return undefined;
  }
  const entitlement = evaluateEntitlement(app, room, request.identity.sub);
  if (!entitlement.allowed) {
    await reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    return undefined;
  }
  return room;
}

function checkpointExists(room: RaceRoom, checkpointId: string): boolean {
  return room.course?.checkpoints.some((checkpoint) => checkpoint.id === checkpointId) === true;
}

function overlayForCheckpoint(room: RaceRoom, checkpointId: string): RaceRoomStopPlan | undefined {
  return room.stopPlans?.find((plan) => plan.checkpointId === checkpointId);
}

function toStopPlanResponse(roomId: string, checkpointId: string, plan: RaceRoomStopPlan | undefined): StopPlanResponse {
  return {
    roomId,
    checkpointId,
    ...(plan?.delayOverrideSeconds !== undefined ? { delayOverrideSeconds: plan.delayOverrideSeconds } : {}),
    ...(plan?.athleteNotes ? { athleteNotes: plan.athleteNotes } : {}),
    ...(plan?.planNotes ? { planNotes: plan.planNotes } : {})
  };
}

function resolveNote(
  incoming: { id?: string; body: string } | null | undefined,
  existing: StopPlanNote | undefined,
  fieldPresent: boolean
): StopPlanNote | undefined {
  if (!fieldPresent) {
    return existing;
  }
  if (incoming === null || incoming === undefined) {
    return undefined;
  }
  if (incoming.body.trim().length === 0) {
    return undefined;
  }
  const id = incoming.id?.trim() || existing?.id || randomUUID();
  return { id, body: incoming.body };
}

function applyStopPlanUpsert(
  existing: RaceRoomStopPlan | undefined,
  checkpointId: string,
  patch: UpsertStopPlanInput
): RaceRoomStopPlan | undefined {
  let delayOverrideSeconds = existing?.delayOverrideSeconds;
  if (patch.delayOverrideSeconds !== undefined) {
    delayOverrideSeconds = patch.delayOverrideSeconds === null ? undefined : patch.delayOverrideSeconds;
  }

  const athleteNotes = resolveNote(
    patch.athleteNotes,
    existing?.athleteNotes,
    patch.athleteNotes !== undefined
  );
  const planNotes = resolveNote(patch.planNotes, existing?.planNotes, patch.planNotes !== undefined);

  if (delayOverrideSeconds === undefined && !athleteNotes && !planNotes) {
    return undefined;
  }
  return {
    checkpointId,
    ...(delayOverrideSeconds !== undefined ? { delayOverrideSeconds } : {}),
    ...(athleteNotes ? { athleteNotes } : {}),
    ...(planNotes ? { planNotes } : {})
  };
}

function replaceStopPlan(room: RaceRoom, checkpointId: string, next: RaceRoomStopPlan | undefined): RaceRoom {
  const others = (room.stopPlans ?? []).filter((plan) => plan.checkpointId !== checkpointId);
  const stopPlans = next ? [...others, next] : others;
  if (stopPlans.length === 0) {
    const rest = { ...room };
    delete rest.stopPlans;
    return rest;
  }
  return { ...room, stopPlans };
}

async function upsertStopPlan(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<unknown> {
  const { roomId, checkpointId } = request.params as { roomId: string; checkpointId: string };
  const room = await requireCourseEditor(app, request, reply, roomId);
  if (!room) {
    return;
  }

  const parsed = upsertStopPlanInput.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid stop-plan payload" });
  }

  if (!checkpointExists(room, checkpointId)) {
    return reply.code(404).send({ error: "Checkpoint not found" });
  }

  const idem = await beginIdempotentMutation(request, parsed.data);
  if (idem.kind === "replay") {
    return reply.code(idem.statusCode).send(idem.body);
  }
  if (idem.kind === "conflict" || idem.kind === "in_progress") {
    return idempotencyErrorReply(reply, idem);
  }

  let finished = false;
  try {
    const latest = (await getRaceRoom(roomId)) ?? room;
    const nextPlan = applyStopPlanUpsert(overlayForCheckpoint(latest, checkpointId), checkpointId, parsed.data);
    const updatedRoom = replaceStopPlan(latest, checkpointId, nextPlan);
    await saveRaceRoom(updatedRoom);
    const body = toStopPlanResponse(roomId, checkpointId, overlayForCheckpoint(updatedRoom, checkpointId));
    await completeIdempotentMutation(request, parsed.data, 200, body);
    finished = true;
    return reply.send(body);
  } finally {
    if (!finished) {
      await releaseIdempotentMutation(request, parsed.data);
    }
  }
}

export async function raceRoomStopPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get("/race-rooms/:roomId/stop-plans", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await requireRoomMember(app, request, reply, roomId);
    if (!room) {
      return;
    }
    const knownIds = new Set((room.course?.checkpoints ?? []).map((checkpoint) => checkpoint.id));
    const stopPlans = (room.stopPlans ?? []).filter((plan) => knownIds.has(plan.checkpointId));
    return reply.send({ roomId, stopPlans });
  });

  app.get("/race-rooms/:roomId/stop-plans/:checkpointId", async (request, reply) => {
    const { roomId, checkpointId } = request.params as { roomId: string; checkpointId: string };
    const room = await requireRoomMember(app, request, reply, roomId);
    if (!room) {
      return;
    }
    if (!checkpointExists(room, checkpointId)) {
      return reply.code(404).send({ error: "Checkpoint not found" });
    }
    return reply.send(toStopPlanResponse(roomId, checkpointId, overlayForCheckpoint(room, checkpointId)));
  });

  app.put("/race-rooms/:roomId/stop-plans/:checkpointId", async (request, reply) => {
    return upsertStopPlan(app, request, reply);
  });
  app.patch("/race-rooms/:roomId/stop-plans/:checkpointId", async (request, reply) => {
    return upsertStopPlan(app, request, reply);
  });

  app.delete("/race-rooms/:roomId/stop-plans/:checkpointId", async (request, reply) => {
    const { roomId, checkpointId } = request.params as { roomId: string; checkpointId: string };
    const room = await requireCourseEditor(app, request, reply, roomId);
    if (!room) {
      return;
    }
    if (!checkpointExists(room, checkpointId)) {
      return reply.code(404).send({ error: "Checkpoint not found" });
    }

    const idemBody = { clear: true };
    const idem = await beginIdempotentMutation(request, idemBody);
    if (idem.kind === "replay") {
      return reply.code(idem.statusCode).send(idem.body);
    }
    if (idem.kind === "conflict" || idem.kind === "in_progress") {
      return idempotencyErrorReply(reply, idem);
    }

    let finished = false;
    try {
      const latest = (await getRaceRoom(roomId)) ?? room;
      const updatedRoom = replaceStopPlan(latest, checkpointId, undefined);
      await saveRaceRoom(updatedRoom);
      const body = toStopPlanResponse(roomId, checkpointId, undefined);
      await completeIdempotentMutation(request, idemBody, 200, body);
      finished = true;
      return reply.send(body);
    } finally {
      if (!finished) {
        await releaseIdempotentMutation(request, idemBody);
      }
    }
  });
}
