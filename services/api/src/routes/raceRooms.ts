import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AthletePingHistoryEntry,
  AthletePingRejectReason,
  CheckpointPlan,
  CrewAssignment,
  CrewTask,
  CrewTaskStatus,
  OpsTimelineEvent,
  ProtocolNote,
  RaceRoom,
  RaceRoomInvite,
  RaceRoomProjection,
  RaceRoomProjectionCore,
  Role
} from "@crewcue/contracts";
import {
  DEFAULT_PLANNED_PACE_SECONDS_PER_KM,
  DEFAULT_RACE_COURSE,
  recomputeRaceProjection
} from "../lib/raceProjection.js";
import { attachProjectionTimeliness } from "../lib/projectionTimeliness.js";

const createRaceRoomInput = z.object({
  teamId: z.string().min(1),
  athleteId: z.string().min(1),
  name: z.string().min(1),
  creatorRole: z.enum(["athlete", "crew_member", "crew_chief", "team_manager"]).default("athlete")
});

const raceCourseCheckpointInput = z.object({
  id: z.string().min(1),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180)
});

const raceCourseInput = z.object({
  checkpoints: z.array(raceCourseCheckpointInput).min(2)
});

const activateRaceRoomInput = z.object({
  eventEndsAt: z.iso.datetime(),
  course: raceCourseInput.optional(),
  plannedPaceSecondsPerKm: z.number().positive().optional()
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

const ingestAthletePingInput = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  recordedAt: z.iso.datetime(),
  horizontalAccuracyMeters: z.number().positive().optional(),
  uploadIntervalSeconds: z.number().int().min(10).max(900).optional()
});

const raceRooms = new Map<string, RaceRoom>();
const raceRoomInvites = new Map<string, RaceRoomInvite>();

/** WS2 Task 1 — last accepted ping + bounded decision history per room */
type AcceptedPing = {
  pingId: string;
  latitude: number;
  longitude: number;
  recordedAtMs: number;
  receivedAtMs: number;
};

type RoomPingState = {
  lastAccepted: AcceptedPing | null;
  history: AthletePingHistoryEntry[];
  /** Last athlete-declared target ping interval (seconds); drives staleness threshold when set. */
  lastUploadIntervalSeconds?: number;
};

const roomPingState = new Map<string, RoomPingState>();

type RoomProjectionState = {
  lastProgressMeters: number;
  splitCrossedAt: Record<string, string>;
  lastProjectionCore: RaceRoomProjectionCore;
};

const roomProjectionState = new Map<string, RoomProjectionState>();

type RoomTaskBoardState = {
  checkpointPlans: CheckpointPlan[];
  tasks: CrewTask[];
  assignments: CrewAssignment[];
  protocolNotes: ProtocolNote[];
  timelineEvents: OpsTimelineEvent[];
};

const roomTaskBoardState = new Map<string, RoomTaskBoardState>();

const TASK_TIMELINE_CAP = 100;

const MAX_CLOCK_SKEW_MS = 120_000;
const MAX_SPEED_MPS = 15;
const MAX_HORIZONTAL_ACCURACY_M = 500;
const PING_HISTORY_CAP = 50;

function getOrInitPingState(roomId: string): RoomPingState {
  let state = roomPingState.get(roomId);
  if (!state) {
    state = { lastAccepted: null, history: [] };
    roomPingState.set(roomId, state);
  }
  return state;
}

function buildInitialTaskBoard(room: RaceRoom): RoomTaskBoardState {
  if (!room.course) {
    return { checkpointPlans: [], tasks: [], assignments: [], protocolNotes: [], timelineEvents: [] };
  }

  const checkpoints = room.course.checkpoints.slice(0, Math.min(room.course.checkpoints.length, 3));
  const roleCycle: Role[] = ["crew_chief", "crew_member", "crew_member"];
  const now = new Date().toISOString();

  const checkpointPlans = checkpoints.map((checkpoint, index) => ({
    id: randomUUID(),
    roomId: room.id,
    checkpointId: checkpoint.id,
    title: `Checkpoint ${index + 1} aid plan`,
    notes: index === 0 ? "Quick refill + status check." : undefined,
    createdAt: now,
    updatedAt: now,
    authoredByUserId: room.athleteId
  }));

  const tasks = checkpointPlans.map((plan, index) => ({
    id: randomUUID(),
    roomId: room.id,
    checkpointId: plan.checkpointId,
    checkpointPlanId: plan.id,
    title: index === 0 ? "Prepare handoff" : index === 1 ? "Monitor nutrition" : "Confirm exit checklist",
    description:
      index === 0
        ? "Have bottles and fuel ready before athlete arrival."
        : index === 1
          ? "Confirm calories, fluids, and heat notes at the stop."
          : "Make sure athlete leaves with the next checkpoint plan.",
    status: "pending" as const,
    createdAt: now,
    updatedAt: now,
    createdByUserId: room.athleteId
  }));

  const assignments = tasks.map((task, index) => ({
    id: randomUUID(),
    roomId: room.id,
    taskId: task.id,
    assigneeUserId: `${roleCycle[index] ?? "crew_member"}-placeholder`,
    assigneeRole: roleCycle[index] ?? "crew_member",
    assignedByUserId: room.athleteId,
    assignedAt: now
  }));

  return { checkpointPlans, tasks, assignments, protocolNotes: [], timelineEvents: [] };
}

function getOrInitTaskBoard(room: RaceRoom): RoomTaskBoardState {
  let state = roomTaskBoardState.get(room.id);
  if (!state) {
    state = buildInitialTaskBoard(room);
    roomTaskBoardState.set(room.id, state);
  }
  if (!state.timelineEvents) {
    state.timelineEvents = [];
  }
  return state;
}

const assignTaskInput = z.object({
  assigneeUserId: z.string().min(1),
  assigneeRole: z.enum(["athlete", "crew_member", "crew_chief", "team_manager"])
});

const upsertProtocolNoteInput = z.object({
  checkpointId: z.string().min(1),
  category: z.enum(["heat", "nutrition", "blister", "other"]),
  body: z.string().trim().min(1).max(5_000)
});

function canAssignRoomTasks(role: Role): boolean {
  return role === "crew_chief" || role === "team_manager" || role === "athlete";
}

function canPrivilegedTaskMutation(role: Role): boolean {
  return canAssignRoomTasks(role);
}

function assignmentForTask(board: RoomTaskBoardState, taskId: string): CrewAssignment | undefined {
  return board.assignments.find((a) => a.taskId === taskId);
}

function isAssigneeForTask(board: RoomTaskBoardState, taskId: string, userId: string): boolean {
  const assignment = assignmentForTask(board, taskId);
  return assignment !== undefined && assignment.assigneeUserId === userId;
}

function appendTaskTimeline(board: RoomTaskBoardState, event: Omit<OpsTimelineEvent, "id">): void {
  const full: OpsTimelineEvent = { ...event, id: randomUUID() };
  board.timelineEvents.push(full);
  if (board.timelineEvents.length > TASK_TIMELINE_CAP) {
    board.timelineEvents.splice(0, board.timelineEvents.length - TASK_TIMELINE_CAP);
  }
}

function sortTimelineAscending(events: OpsTimelineEvent[]): OpsTimelineEvent[] {
  return [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

function pushPingHistory(roomId: string, entry: AthletePingHistoryEntry): void {
  const state = getOrInitPingState(roomId);
  state.history.push(entry);
  if (state.history.length > PING_HISTORY_CAP) {
    state.history.splice(0, state.history.length - PING_HISTORY_CAP);
  }
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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

function getTaskBoardVisibleRoles(role: Role): Role[] {
  if (role === "crew_member") {
    return ["crew_member"];
  }
  return ["athlete", "crew_member", "crew_chief", "team_manager"];
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

    const activatedAt = new Date().toISOString();
    const course = parsed.data.course ?? DEFAULT_RACE_COURSE;
    const plannedPaceSecondsPerKm = parsed.data.plannedPaceSecondsPerKm ?? DEFAULT_PLANNED_PACE_SECONDS_PER_KM;

    const activated: RaceRoom = {
      ...room,
      status: "active",
      activatedAt,
      eventEndsAt: parsed.data.eventEndsAt,
      course,
      plannedPaceSecondsPerKm
    };

    roomProjectionState.delete(roomId);
    roomTaskBoardState.delete(roomId);
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

  app.post("/race-rooms/:roomId/pings", async (request, reply) => {
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

    const parsed = ingestAthletePingInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ping payload" });
    }

    const body = parsed.data;
    const receivedAt = new Date().toISOString();
    const receivedAtMs = Date.parse(receivedAt);
    const recordedAtMs = Date.parse(body.recordedAt);

    const reject = (reason: AthletePingRejectReason, message: string) => {
      const entry: AthletePingHistoryEntry = {
        id: randomUUID(),
        at: receivedAt,
        actor: request.identity!.sub,
        decision: "rejected",
        reason
      };
      pushPingHistory(roomId, entry);
      app.log.info(
        { ping_decision: { roomId, actor: request.identity!.sub, decision: "rejected", reason } },
        "ping_decision"
      );
      return reply.code(422).send({ decision: "rejected" as const, reason, message });
    };

    if (room.status !== "active") {
      return reject("room_not_active", "Race room must be active to ingest pings");
    }

    if (body.horizontalAccuracyMeters !== undefined && body.horizontalAccuracyMeters > MAX_HORIZONTAL_ACCURACY_M) {
      return reject("accuracy_too_poor", "Horizontal accuracy exceeds allowed threshold");
    }

    if (Number.isNaN(recordedAtMs)) {
      return reply.code(400).send({ error: "Invalid ping payload" });
    }

    if (Math.abs(receivedAtMs - recordedAtMs) > MAX_CLOCK_SKEW_MS) {
      return reject("clock_skew", "recordedAt is too far from server time");
    }

    const pingState = getOrInitPingState(roomId);
    if (pingState.lastAccepted) {
      const dtSec = (recordedAtMs - pingState.lastAccepted.recordedAtMs) / 1000;
      if (dtSec > 0) {
        const dist = distanceMeters(
          pingState.lastAccepted.latitude,
          pingState.lastAccepted.longitude,
          body.latitude,
          body.longitude
        );
        const impliedSpeed = dist / dtSec;
        if (impliedSpeed > MAX_SPEED_MPS) {
          return reject("implausible_motion", "Movement exceeds plausible speed for elapsed time");
        }
      }
    }

    const pingId = randomUUID();
    pingState.lastAccepted = {
      pingId,
      latitude: body.latitude,
      longitude: body.longitude,
      recordedAtMs,
      receivedAtMs
    };
    if (body.uploadIntervalSeconds !== undefined) {
      pingState.lastUploadIntervalSeconds = body.uploadIntervalSeconds;
    }

    const acceptedEntry: AthletePingHistoryEntry = {
      id: randomUUID(),
      at: receivedAt,
      actor: request.identity.sub,
      decision: "accepted",
      pingId
    };
    pushPingHistory(roomId, acceptedEntry);

    app.log.info(
      { ping_decision: { roomId, actor: request.identity.sub, decision: "accepted", pingId } },
      "ping_decision"
    );

    let projection: RaceRoomProjection | undefined;
    if (room.course && room.plannedPaceSecondsPerKm !== undefined && room.activatedAt) {
      const prev = roomProjectionState.get(roomId);
      try {
        const { projection: nextProjectionCore, state } = recomputeRaceProjection({
          roomId,
          activatedAt: room.activatedAt,
          course: room.course,
          plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
          ping: {
            pingId,
            latitude: body.latitude,
            longitude: body.longitude,
            recordedAt: body.recordedAt
          },
          previous: prev
            ? {
                lastProgressMeters: prev.lastProgressMeters,
                splitCrossedAt: { ...prev.splitCrossedAt }
              }
            : null
        });
        const evaluatedAtMs = Date.now();
        projection = attachProjectionTimeliness(
          nextProjectionCore,
          recordedAtMs,
          evaluatedAtMs,
          pingState.lastUploadIntervalSeconds
        );
        roomProjectionState.set(roomId, {
          lastProgressMeters: state.lastProgressMeters,
          splitCrossedAt: { ...state.splitCrossedAt },
          lastProjectionCore: nextProjectionCore
        });
        app.log.info(
          {
            projection_recompute: {
              roomId,
              pingId,
              progressMeters: nextProjectionCore.progressMeters,
              courseLengthMeters: nextProjectionCore.courseLengthMeters
            }
          },
          "projection_recompute"
        );
      } catch (err) {
        app.log.warn({ err, roomId }, "projection_recompute_failed");
      }
    }

    return reply.code(201).send({
      decision: "accepted" as const,
      pingId,
      roomId,
      recordedAt: body.recordedAt,
      receivedAt,
      latitude: body.latitude,
      longitude: body.longitude,
      ...(body.horizontalAccuracyMeters !== undefined
        ? { horizontalAccuracyMeters: body.horizontalAccuracyMeters }
        : {}),
      ...(projection ? { projection } : {})
    });
  });

  app.get("/race-rooms/:roomId/projection", async (request, reply) => {
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

    const stored = roomProjectionState.get(roomId);
    if (!stored) {
      return reply.code(404).send({ error: "Projection not available" });
    }

    const pingState = getOrInitPingState(roomId);
    const view = attachProjectionTimeliness(
      stored.lastProjectionCore,
      pingState.lastAccepted?.recordedAtMs ?? null,
      Date.now(),
      pingState.lastUploadIntervalSeconds
    );
    return reply.send(view);
  });

  app.get("/race-rooms/:roomId/tasks", async (request, reply) => {
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

    const checkpointIdRaw = (request.query as { checkpointId?: string }).checkpointId;
    const checkpointId = typeof checkpointIdRaw === "string" && checkpointIdRaw.length > 0 ? checkpointIdRaw : undefined;

    const board = getOrInitTaskBoard(room);
    const visibleRoles = new Set(getTaskBoardVisibleRoles(membership.role));
    const assignments = board.assignments.filter((assignment) => visibleRoles.has(assignment.assigneeRole));
    const visibleTaskIds = new Set(assignments.map((assignment) => assignment.taskId));

    const tasks = board.tasks.filter((task) => {
      if (!visibleTaskIds.has(task.id)) {
        return false;
      }
      return checkpointId ? task.checkpointId === checkpointId : true;
    });
    const taskIds = new Set(tasks.map((task) => task.id));
    const filteredAssignments = assignments.filter((assignment) => taskIds.has(assignment.taskId));
    const checkpointIds = new Set(tasks.map((task) => task.checkpointId));
    const checkpointPlans = board.checkpointPlans.filter((plan) => checkpointIds.has(plan.checkpointId));

    return reply.send({
      checkpointPlans,
      tasks,
      assignments: filteredAssignments
    });
  });

  app.post("/race-rooms/:roomId/tasks/:taskId/assign", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const taskId = (request.params as { taskId: string }).taskId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    if (!canAssignRoomTasks(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = assignTaskInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid assign task payload" });
    }

    const assigneeMember = room.memberships.find((m) => m.userId === parsed.data.assigneeUserId);
    if (!assigneeMember || assigneeMember.role !== parsed.data.assigneeRole) {
      return reply.code(400).send({ error: "Assignee is not a room member with the given role" });
    }

    const board = getOrInitTaskBoard(room);
    const taskIndex = board.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const now = new Date().toISOString();
    const existingIdx = board.assignments.findIndex((a) => a.taskId === taskId);
    const nextAssignment: CrewAssignment = {
      id: existingIdx >= 0 ? board.assignments[existingIdx]!.id : randomUUID(),
      roomId,
      taskId,
      assigneeUserId: parsed.data.assigneeUserId,
      assigneeRole: parsed.data.assigneeRole,
      assignedByUserId: request.identity.sub,
      assignedAt: now
    };
    if (existingIdx >= 0) {
      board.assignments[existingIdx] = nextAssignment;
    } else {
      board.assignments.push(nextAssignment);
    }

    appendTaskTimeline(board, {
      roomId,
      occurredAt: now,
      kind: "task_assigned",
      actorUserId: request.identity.sub,
      message: `Task assigned to ${parsed.data.assigneeRole}`,
      taskId
    });

    return reply.send({ task: board.tasks[taskIndex]!, assignment: nextAssignment });
  });

  app.post("/race-rooms/:roomId/tasks/:taskId/start", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const taskId = (request.params as { taskId: string }).taskId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const board = getOrInitTaskBoard(room);
    const taskIndex = board.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const task = board.tasks[taskIndex]!;
    if (task.status !== "pending") {
      return reply.code(409).send({ error: "Task cannot be started from its current state" });
    }

    const privileged = canPrivilegedTaskMutation(membership.role);
    const assignee = isAssigneeForTask(board, taskId, request.identity.sub);
    if (!privileged && !assignee) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const now = new Date().toISOString();
    const nextStatus: CrewTaskStatus = "in_progress";
    board.tasks[taskIndex] = { ...task, status: nextStatus, updatedAt: now };

    appendTaskTimeline(board, {
      roomId,
      occurredAt: now,
      kind: "task_started",
      actorUserId: request.identity.sub,
      message: "Task started",
      taskId
    });

    return reply.send({ task: board.tasks[taskIndex]! });
  });

  app.post("/race-rooms/:roomId/tasks/:taskId/complete", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const taskId = (request.params as { taskId: string }).taskId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const board = getOrInitTaskBoard(room);
    const taskIndex = board.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const task = board.tasks[taskIndex]!;
    if (task.status !== "in_progress") {
      return reply.code(409).send({ error: "Task cannot be completed from its current state" });
    }

    const privileged = canPrivilegedTaskMutation(membership.role);
    const assignee = isAssigneeForTask(board, taskId, request.identity.sub);
    if (!privileged && !assignee) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const now = new Date().toISOString();
    const nextStatus: CrewTaskStatus = "completed";
    board.tasks[taskIndex] = { ...task, status: nextStatus, updatedAt: now };

    appendTaskTimeline(board, {
      roomId,
      occurredAt: now,
      kind: "task_completed",
      actorUserId: request.identity.sub,
      message: "Task completed",
      taskId
    });

    return reply.send({ task: board.tasks[taskIndex]! });
  });

  app.get("/race-rooms/:roomId/protocol-notes", async (request, reply) => {
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

    const checkpointIdRaw = (request.query as { checkpointId?: string }).checkpointId;
    const checkpointId = typeof checkpointIdRaw === "string" && checkpointIdRaw.length > 0 ? checkpointIdRaw : undefined;

    const board = getOrInitTaskBoard(room);
    const notes = checkpointId
      ? board.protocolNotes.filter((note) => note.checkpointId === checkpointId)
      : board.protocolNotes;
    return reply.send({ protocolNotes: notes });
  });

  app.post("/race-rooms/:roomId/protocol-notes", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = raceRooms.get(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = upsertProtocolNoteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid protocol note payload" });
    }

    if (room.course && !room.course.checkpoints.some((cp) => cp.id === parsed.data.checkpointId)) {
      return reply.code(400).send({ error: "Unknown checkpointId for this room course" });
    }

    const now = new Date().toISOString();
    const board = getOrInitTaskBoard(room);
    const existingIdx = board.protocolNotes.findIndex(
      (note) => note.checkpointId === parsed.data.checkpointId && note.category === parsed.data.category
    );

    const next: ProtocolNote = {
      id: existingIdx >= 0 ? board.protocolNotes[existingIdx]!.id : randomUUID(),
      roomId,
      checkpointId: parsed.data.checkpointId,
      category: parsed.data.category,
      body: parsed.data.body,
      createdAt: existingIdx >= 0 ? board.protocolNotes[existingIdx]!.createdAt : now,
      updatedAt: now,
      authorUserId: request.identity.sub
    };

    if (existingIdx >= 0) {
      board.protocolNotes[existingIdx] = next;
    } else {
      board.protocolNotes.push(next);
    }

    appendTaskTimeline(board, {
      roomId,
      occurredAt: now,
      kind: "protocol_updated",
      actorUserId: request.identity.sub,
      message: `Protocol updated (${next.category})`,
      protocolNoteId: next.id
    });

    return reply.send({ protocolNote: next });
  });

  app.get("/race-rooms/:roomId/timeline", async (request, reply) => {
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

    const board = getOrInitTaskBoard(room);
    const events = sortTimelineAscending(board.timelineEvents);
    return reply.send({ events });
  });

  app.get("/race-rooms/:roomId/pings/history", async (request, reply) => {
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

    const limitRaw = (request.query as { limit?: string }).limit;
    const limitParsed = z.coerce.number().int().min(1).max(50).safeParse(limitRaw ?? "20");
    const limit = limitParsed.success ? limitParsed.data : 20;

    const state = getOrInitPingState(roomId);
    const decisions = state.history.slice(-limit);
    return reply.send({ decisions });
  });
}
