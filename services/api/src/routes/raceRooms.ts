import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RaceRoom, Role } from "@crewcue/contracts";

const createRaceRoomInput = z.object({
  teamId: z.string().min(1),
  athleteId: z.string().min(1),
  name: z.string().min(1),
  creatorRole: z.enum(["athlete", "crew_member", "crew_chief", "team_manager"]).default("athlete")
});

const activateRaceRoomInput = z.object({
  eventEndsAt: z.iso.datetime()
});

const updateEntitlementInput = z.object({
  status: z.enum(["unpaid", "paid", "expired"])
});

const raceRooms = new Map<string, RaceRoom>();

type PermissionSet = {
  canViewRoom: boolean;
  canActivateRoom: boolean;
};

function getPermissions(role: Role): PermissionSet {
  const canActivateRoom = role === "athlete" || role === "crew_chief" || role === "team_manager";
  return {
    canViewRoom: true,
    canActivateRoom
  };
}

function evaluateEntitlement(app: FastifyInstance, room: RaceRoom, actor: string): { allowed: boolean; code?: number; error?: string } {
  const decision = {
    roomId: room.id,
    actor,
    entitlementStatus: room.entitlement.status
  };

  if (room.entitlement.status === "paid") {
    app.log.info({ entitlement: { ...decision, allowed: true } }, "entitlement_decision");
    return { allowed: true };
  }

  if (room.entitlement.status === "unpaid") {
    app.log.info({ entitlement: { ...decision, allowed: false } }, "entitlement_decision");
    return { allowed: false, code: 402, error: "Entitlement unpaid" };
  }

  app.log.info({ entitlement: { ...decision, allowed: false } }, "entitlement_decision");
  return { allowed: false, code: 403, error: "Entitlement expired" };
}

export async function raceRoomRoutes(app: FastifyInstance): Promise<void> {
  app.post("/race-rooms", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = createRaceRoomInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid race room payload" });
    }

    const now = new Date().toISOString();
    const roomId = randomUUID();
    const room: RaceRoom = {
      id: roomId,
      teamId: parsed.data.teamId,
      athleteId: parsed.data.athleteId,
      name: parsed.data.name,
      status: "draft",
      createdAt: now,
      entitlement: {
        status: "unpaid",
        lastUpdatedAt: now,
        source: "manual"
      },
      memberships: [
        {
          userId: request.identity.sub,
          role: parsed.data.creatorRole,
          joinedAt: now
        }
      ]
    };

    raceRooms.set(roomId, room);
    return reply.code(201).send(room);
  });

  app.get("/race-rooms/:roomId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const permissions = getPermissions(membership.role);
    return reply.send({ room, permissions });
  });

  app.post("/race-rooms/:roomId/activate", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const permissions = getPermissions(membership.role);
    if (!permissions.canActivateRoom) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = activateRaceRoomInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid activation payload" });
    }

    const activated: RaceRoom = {
      ...room,
      status: "active",
      activatedAt: new Date().toISOString(),
      eventEndsAt: parsed.data.eventEndsAt
    };

    raceRooms.set(roomId, activated);
    return reply.send(activated);
  });

  app.post("/race-rooms/:roomId/entitlement", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const permissions = getPermissions(membership.role);
    if (!permissions.canActivateRoom) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const parsed = updateEntitlementInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid entitlement payload" });
    }

    const updated: RaceRoom = {
      ...room,
      entitlement: {
        status: parsed.data.status,
        lastUpdatedAt: new Date().toISOString(),
        source: "manual"
      }
    };

    raceRooms.set(roomId, updated);
    return reply.send(updated.entitlement);
  });
}
