import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AthleteStatusCard,
  AthleteStatusCardMetricCell,
  CheckpointDemandCell,
  CheckpointDemandHeatmap,
  CommandCenterMetricKind,
  IdentityClaims,
  RaceRoom,
  Role,
  StaffingOverlap,
  TeamCommandBoard,
  TeamCommandMetricConfig
} from "@crewcue/contracts";
import {
  isRoomPersistenceEnabled,
  loadTeamMetricConfigPayload,
  persistTeamMetricConfigPayload
} from "../lib/roomPersistence.js";
import {
  evaluateEntitlement,
  getProjectionViewForRoom,
  getTaskStatusCountsForRoom,
  listActiveDemandCheckpointsForRoom,
  listInProgressAssignmentsForRoom,
  listRaceRoomsByTeamId
} from "./raceRooms.js";
import { getWs5RoomCommandCenterSummary } from "./ws5SyncRoutes.js";

const metricKindSchema = z.enum(["calories_per_hr", "carbs_per_hr", "electrolytes_per_hr", "sodium_per_hr"]);

const putMetricConfigInput = z.object({
  selectedMetrics: z.array(metricKindSchema).min(1).max(4)
});

const teamMetricConfigs = new Map<string, TeamCommandMetricConfig>();

const teamMetricHydratedFromDb = new Set<string>();

const WS6_STALE_SECONDS = Number.parseInt(
  process.env.WS6_SYNC_STALE_AFTER_SECONDS ?? process.env.SYNC_STALE_AFTER_SECONDS ?? "120",
  10
);

function defaultMetricConfig(teamId: string): TeamCommandMetricConfig {
  const now = new Date().toISOString();
  return {
    teamId,
    selectedMetrics: ["calories_per_hr", "carbs_per_hr"],
    updatedAt: now,
    updatedByUserId: "system"
  };
}

function normalizeTeamMetricConfigPayload(raw: unknown, teamId: string): TeamCommandMetricConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  if (
    rec.teamId !== teamId ||
    !Array.isArray(rec.selectedMetrics) ||
    typeof rec.updatedAt !== "string" ||
    typeof rec.updatedByUserId !== "string"
  ) {
    return undefined;
  }
  return {
    teamId,
    selectedMetrics: rec.selectedMetrics as TeamCommandMetricConfig["selectedMetrics"],
    updatedAt: rec.updatedAt,
    updatedByUserId: rec.updatedByUserId
  };
}

async function loadTeamMetricConfigIfNeeded(teamId: string): Promise<void> {
  if (!isRoomPersistenceEnabled()) {
    return;
  }
  if (teamMetricHydratedFromDb.has(teamId)) {
    return;
  }
  teamMetricHydratedFromDb.add(teamId);
  const raw = await loadTeamMetricConfigPayload(teamId);
  const parsed = normalizeTeamMetricConfigPayload(raw, teamId);
  if (parsed) {
    teamMetricConfigs.set(teamId, parsed);
  }
}

async function loadOrInitTeamMetricConfig(teamId: string): Promise<TeamCommandMetricConfig> {
  await loadTeamMetricConfigIfNeeded(teamId);
  const cur = teamMetricConfigs.get(teamId);
  if (cur) {
    return cur;
  }
  const init = defaultMetricConfig(teamId);
  teamMetricConfigs.set(teamId, init);
  if (isRoomPersistenceEnabled()) {
    await persistTeamMetricConfigPayload(teamId, init);
  }
  return init;
}

async function saveTeamMetricConfigSnapshot(teamId: string): Promise<void> {
  if (!isRoomPersistenceEnabled()) {
    return;
  }
  const cur = teamMetricConfigs.get(teamId);
  if (!cur) {
    return;
  }
  await persistTeamMetricConfigPayload(teamId, cur);
}

function roleCanViewCommandCenter(role: Role): boolean {
  return role === "team_manager" || role === "crew_chief";
}

async function collectVisibleRooms(identity: IdentityClaims, teamId: string): Promise<RaceRoom[] | null> {
  if (!identity.teamIds.includes(teamId)) {
    return null;
  }
  const rooms = await listRaceRoomsByTeamId(teamId);
  const visible = rooms.filter((room) => {
    const m = room.memberships.find((x) => x.userId === identity.sub);
    return m !== undefined && roleCanViewCommandCenter(m.role);
  });
  if (visible.length === 0) {
    return null;
  }
  return visible;
}

async function collectEntitledVisibleRooms(
  app: FastifyInstance,
  identity: IdentityClaims,
  teamId: string
): Promise<RaceRoom[] | null> {
  const visible = await collectVisibleRooms(identity, teamId);
  if (!visible) {
    return null;
  }
  return visible.filter((room) => evaluateEntitlement(app, room, identity.sub).allowed);
}

async function canMutateMetrics(identity: IdentityClaims, teamId: string): Promise<boolean> {
  if (!identity.teamIds.includes(teamId)) {
    return false;
  }
  const rooms = await listRaceRoomsByTeamId(teamId);
  return rooms.some((room) => {
    const m = room.memberships.find((x) => x.userId === identity.sub);
    return m?.role === "team_manager";
  });
}

function stubMetricValue(roomId: string, kind: CommandCenterMetricKind): number {
  const seed = [...roomId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const order: CommandCenterMetricKind[] = [
    "calories_per_hr",
    "carbs_per_hr",
    "electrolytes_per_hr",
    "sodium_per_hr"
  ];
  const idx = Math.max(0, order.indexOf(kind));
  return Math.round(220 + (seed % 70) + idx * 18);
}

function metricBand(kind: CommandCenterMetricKind, value: number): AthleteStatusCardMetricCell["band"] {
  const bands =
    kind === "sodium_per_hr"
      ? { warn: 2500, crit: 3200 }
      : kind === "electrolytes_per_hr"
        ? { warn: 900, crit: 1200 }
        : { warn: 520, crit: 720 };
  if (value >= bands.crit) {
    return "critical";
  }
  if (value >= bands.warn) {
    return "warn";
  }
  return "ok";
}

function buildMetricCells(
  roomId: string,
  selected: CommandCenterMetricKind[],
  useStubs: boolean
): AthleteStatusCardMetricCell[] {
  return selected.map((metric) => {
    if (!useStubs) {
      return { metric, value: null, band: "unknown" };
    }
    const value = stubMetricValue(roomId, metric);
    return { metric, value, band: metricBand(metric, value) };
  });
}

async function buildAthleteCard(
  app: FastifyInstance,
  room: RaceRoom,
  identity: IdentityClaims,
  metricConfig: TeamCommandMetricConfig
): Promise<AthleteStatusCard | null> {
  const ent = evaluateEntitlement(app, room, identity.sub);
  if (!ent.allowed) {
    return null;
  }
  const projection = room.status === "active" ? await getProjectionViewForRoom(room.id) : undefined;
  const taskCountsRecord = await getTaskStatusCountsForRoom(room);
  const syncSummary = await getWs5RoomCommandCenterSummary(room.id, WS6_STALE_SECONDS);
  const useStubs = room.status === "active";
  const metrics = buildMetricCells(room.id, metricConfig.selectedMetrics, useStubs);
  return {
    roomId: room.id,
    athleteId: room.athleteId,
    roomName: room.name,
    roomStatus: room.status,
    ...(projection ? { projection } : {}),
    taskCounts: {
      pending: taskCountsRecord.pending,
      in_progress: taskCountsRecord.in_progress,
      completed: taskCountsRecord.completed,
      cancelled: taskCountsRecord.cancelled
    },
    syncSummary,
    metrics
  };
}

async function computeOverlaps(rooms: RaceRoom[]): Promise<StaffingOverlap[]> {
  const byUser = new Map<string, { roomIds: Set<string>; checkpointIds: Set<string> }>();
  const rowsByRoom = await Promise.all(
    rooms.map(async (room) => ({ room, rows: await listInProgressAssignmentsForRoom(room) }))
  );
  for (const { rows } of rowsByRoom) {
    for (const row of rows) {
      let bucket = byUser.get(row.assigneeUserId);
      if (!bucket) {
        bucket = { roomIds: new Set(), checkpointIds: new Set() };
        byUser.set(row.assigneeUserId, bucket);
      }
      bucket.roomIds.add(row.roomId);
      bucket.checkpointIds.add(row.checkpointId);
    }
  }
  const overlaps: StaffingOverlap[] = [];
  for (const [assigneeUserId, bucket] of byUser) {
    if (bucket.roomIds.size < 2) {
      continue;
    }
    overlaps.push({
      id: randomUUID(),
      assigneeUserId,
      roomIds: [...bucket.roomIds],
      checkpointIds: [...bucket.checkpointIds],
      severity: bucket.roomIds.size > 2 ? "blocking" : "warning",
      note: "Assignee has in-flight crew tasks in more than one active race room."
    });
  }
  return overlaps;
}

async function computeHeatmap(teamId: string, rooms: RaceRoom[]): Promise<CheckpointDemandHeatmap> {
  const demandMap = new Map<string, Set<string>>();
  const demandByRoom = await Promise.all(
    rooms.map(async (room) => ({
      roomId: room.id,
      cpIds: await listActiveDemandCheckpointsForRoom(room)
    }))
  );
  for (const { roomId, cpIds } of demandByRoom) {
    for (const cpId of cpIds) {
      if (!demandMap.has(cpId)) {
        demandMap.set(cpId, new Set());
      }
      demandMap.get(cpId)!.add(roomId);
    }
  }
  const cells: CheckpointDemandCell[] = [...demandMap.entries()]
    .map(([checkpointId, set]) => ({
      checkpointId,
      concurrentRoomDemand: set.size,
      contributingRoomIds: [...set].slice(0, 8)
    }))
    .sort((a, b) => b.concurrentRoomDemand - a.concurrentRoomDemand);
  return {
    teamId,
    evaluatedAt: new Date().toISOString(),
    cells
  };
}

export async function ws6CommandCenterRoutes(app: FastifyInstance): Promise<void> {
  app.get("/teams/:teamId/command-center/board", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const teamId = (request.params as { teamId: string }).teamId;
    const visible = await collectVisibleRooms(identity, teamId);
    if (!visible) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const metricConfig = await loadOrInitTeamMetricConfig(teamId);
    const evaluatedAt = new Date().toISOString();
    const cardResults = await Promise.all(
      visible.map((room) => buildAthleteCard(app, room, identity, metricConfig))
    );
    const cards = cardResults.filter((card): card is AthleteStatusCard => card !== null);

    const board: TeamCommandBoard = {
      teamId,
      evaluatedAt,
      metricConfig,
      cards
    };
    return reply.send({ board });
  });

  app.get("/teams/:teamId/command-center/metric-config", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const teamId = (request.params as { teamId: string }).teamId;
    if (!(await collectVisibleRooms(identity, teamId))) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    return reply.send({ metricConfig: await loadOrInitTeamMetricConfig(teamId) });
  });

  app.put("/teams/:teamId/command-center/metric-config", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const teamId = (request.params as { teamId: string }).teamId;
    if (!(await canMutateMetrics(identity, teamId))) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const parsed = putMetricConfigInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid metric config payload" });
    }

    const now = new Date().toISOString();
    const next: TeamCommandMetricConfig = {
      teamId,
      selectedMetrics: parsed.data.selectedMetrics,
      updatedAt: now,
      updatedByUserId: identity.sub
    };
    teamMetricConfigs.set(teamId, next);
    await saveTeamMetricConfigSnapshot(teamId);
    return reply.send({ metricConfig: next });
  });

  app.get("/teams/:teamId/command-center/staffing-overlaps", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const teamId = (request.params as { teamId: string }).teamId;
    const rooms = await collectEntitledVisibleRooms(app, identity, teamId);
    if (!rooms) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const overlaps = await computeOverlaps(rooms);
    return reply.send({
      overlaps,
      evaluatedAt: new Date().toISOString()
    });
  });

  app.get("/teams/:teamId/command-center/checkpoint-heatmap", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const teamId = (request.params as { teamId: string }).teamId;
    const rooms = await collectEntitledVisibleRooms(app, identity, teamId);
    if (!rooms) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const heatmap = await computeHeatmap(teamId, rooms);
    return reply.send({ heatmap });
  });
}
