import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RaceRoom, RaceRoomInvite, Role } from "@crewcue/contracts";

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

const issueInviteInput = z.object({
  email: z.string().email(),
  role: z.enum(["athlete", "crew_member", "crew_chief", "team_manager"]),
  expiresAt: z.iso.datetime().optional()
});

const acceptInviteInput = z.object({
  token: z.string().min(1)
});

const raceRooms = new Map<string, RaceRoom>();
const raceRoomInvites = new Map<string, RaceRoomInvite>();

type PermissionSet = {
  canViewRoom: boolean;
  canActivateRoom: boolean;
  canIssueInvite: boolean;
};

function getPermissions(role: Role): PermissionSet {
  const canActivateRoom = role === "athlete" || role === "crew_chief" || role === "team_manager";
  const canIssueInvite = role === "athlete" || role === "crew_chief" || role === "team_manager";
  return {
    canViewRoom: true,
    canActivateRoom,
    canIssueInvite
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

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
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

  app.post("/race-rooms/:roomId/invites", async (request, reply) => {
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
    if (!permissions.canIssueInvite) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const parsed = issueInviteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid invite payload" });
    }

    const invite: RaceRoomInvite = {
      token: randomUUID(),
      roomId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      invitedBy: request.identity.sub,
      invitedAt: new Date().toISOString(),
      expiresAt: parsed.data.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      status: "pending"
    };

    raceRoomInvites.set(invite.token, invite);
    return reply.code(201).send({
      token: invite.token,
      roomId: invite.roomId,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt
    });
  });

  app.post("/race-rooms/:roomId/invites/accept", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const parsed = acceptInviteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid invite acceptance payload" });
    }

    const invite = raceRoomInvites.get(parsed.data.token);
    if (!invite || invite.roomId !== roomId) {
      return reply.code(404).send({ error: "Invite not found" });
    }

    if (invite.status !== "pending") {
      return reply.code(409).send({ error: "Invite is not pending" });
    }

    if (isExpired(invite.expiresAt)) {
      raceRoomInvites.set(invite.token, { ...invite, status: "expired" });
      return reply.code(410).send({ error: "Invite expired" });
    }

    const existing = room.memberships.find((member) => member.userId === request.identity?.sub);
    const nextMemberships = existing
      ? room.memberships.map((member) =>
          member.userId === request.identity?.sub ? { ...member, role: invite.role } : member
        )
      : [
          ...room.memberships,
          {
            userId: request.identity.sub,
            role: invite.role,
            joinedAt: new Date().toISOString()
          }
        ];

    const updatedRoom: RaceRoom = {
      ...room,
      memberships: nextMemberships
    };

    raceRooms.set(roomId, updatedRoom);
    raceRoomInvites.set(invite.token, {
      ...invite,
      status: "accepted",
      acceptedBy: request.identity.sub,
      acceptedAt: new Date().toISOString()
    });

    const membership = updatedRoom.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(500).send({ error: "Membership assignment failed" });
    }

    return reply.send({
      room: updatedRoom,
      assignedRole: membership.role,
      permissions: getPermissions(membership.role)
    });
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
