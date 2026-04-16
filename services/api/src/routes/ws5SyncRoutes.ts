import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DeviceHealth, MergeRecord, Role, SyncQueueDiagnostics, SyncStatus } from "@crewcue/contracts";
import { evaluateEntitlement, getRaceRoom } from "./raceRooms.js";

const heartbeatInput = z.object({
  deviceId: z.string().min(1).max(200),
  pendingQueueCount: z.number().int().min(0).max(100_000),
  lastSuccessfulFlushAt: z.iso.datetime().optional()
});

const queueDiagnosticsInput = z.object({
  deviceId: z.string().min(1).max(200),
  pendingByOpType: z.record(z.string().min(1).max(64), z.number().int().min(0).max(100_000))
});

const mergeRecordInput = z.object({
  deviceId: z.string().min(1).max(200),
  conflictKey: z.string().min(1).max(500),
  strategy: z.enum(["last_writer_wins", "manual", "deferred"]),
  notes: z.string().trim().max(2_000).optional()
});

type HeartbeatEntry = {
  userId: string;
  deviceId: string;
  lastHeartbeatAtMs: number;
  pendingQueueCount: number;
  lastSuccessfulFlushAt?: string;
};

type Ws5RoomState = {
  heartbeats: Map<string, HeartbeatEntry>;
  diagnostics: SyncQueueDiagnostics[];
  mergeRecords: MergeRecord[];
};

const ws5RoomState = new Map<string, Ws5RoomState>();

const DEFAULT_STALE_AFTER_SECONDS = Number.parseInt(process.env.SYNC_STALE_AFTER_SECONDS ?? "120", 10);
const DIAGNOSTICS_CAP = 50;
const MERGE_RECORDS_CAP = 100;

function getOrInitWs5(roomId: string): Ws5RoomState {
  let state = ws5RoomState.get(roomId);
  if (!state) {
    state = { heartbeats: new Map(), diagnostics: [], mergeRecords: [] };
    ws5RoomState.set(roomId, state);
  }
  return state;
}

function heartbeatKey(userId: string, deviceId: string): string {
  return `${userId}::${deviceId}`;
}

function canRecordMergeTelemetry(role: Role): boolean {
  return role === "athlete" || role === "crew_chief" || role === "team_manager";
}

export async function ws5SyncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/race-rooms/:roomId/sync/heartbeat", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((m) => m.userId === identity.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = heartbeatInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid heartbeat payload" });
    }

    const state = getOrInitWs5(roomId);
    const nowMs = Date.now();
    const key = heartbeatKey(identity.sub, parsed.data.deviceId);
    state.heartbeats.set(key, {
      userId: identity.sub,
      deviceId: parsed.data.deviceId,
      lastHeartbeatAtMs: nowMs,
      pendingQueueCount: parsed.data.pendingQueueCount,
      ...(parsed.data.lastSuccessfulFlushAt !== undefined
        ? { lastSuccessfulFlushAt: parsed.data.lastSuccessfulFlushAt }
        : {})
    });

    return reply.send({
      ok: true,
      lastHeartbeatAt: new Date(nowMs).toISOString()
    });
  });

  app.get("/race-rooms/:roomId/sync/health", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((m) => m.userId === identity.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const q = request.query as { staleAfterSeconds?: string };
    const staleParsed = z.coerce.number().int().min(0).max(3_600).safeParse(q.staleAfterSeconds ?? `${DEFAULT_STALE_AFTER_SECONDS}`);
    const staleAfterSeconds = staleParsed.success ? staleParsed.data : DEFAULT_STALE_AFTER_SECONDS;

    const state = getOrInitWs5(roomId);
    const evaluatedAtMs = Date.now();
    const evaluatedAt = new Date(evaluatedAtMs).toISOString();

    const devices: DeviceHealth[] = [];
    let totalPending = 0;
    for (const entry of state.heartbeats.values()) {
      const ageSeconds = (evaluatedAtMs - entry.lastHeartbeatAtMs) / 1000;
      const isStale = ageSeconds > staleAfterSeconds;
      totalPending += entry.pendingQueueCount;
      devices.push({
        deviceId: entry.deviceId,
        roomId,
        userId: entry.userId,
        lastHeartbeatAt: new Date(entry.lastHeartbeatAtMs).toISOString(),
        pendingQueueCount: entry.pendingQueueCount,
        ...(entry.lastSuccessfulFlushAt !== undefined ? { lastSuccessfulFlushAt: entry.lastSuccessfulFlushAt } : {}),
        isStale
      });
    }

    const status: SyncStatus = {
      roomId,
      evaluatedAt,
      staleAfterSeconds,
      devices,
      totalPendingAcrossDevices: totalPending
    };

    return reply.send({ syncStatus: status });
  });

  app.post("/race-rooms/:roomId/sync/queue-diagnostics", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((m) => m.userId === identity.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = queueDiagnosticsInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid queue diagnostics payload" });
    }

    const now = new Date().toISOString();
    const row: SyncQueueDiagnostics = {
      id: randomUUID(),
      roomId,
      deviceId: parsed.data.deviceId,
      userId: identity.sub,
      pendingByOpType: parsed.data.pendingByOpType,
      reportedAt: now
    };

    const state = getOrInitWs5(roomId);
    state.diagnostics.push(row);
    if (state.diagnostics.length > DIAGNOSTICS_CAP) {
      state.diagnostics.splice(0, state.diagnostics.length - DIAGNOSTICS_CAP);
    }

    return reply.code(201).send({ diagnostics: row });
  });

  app.get("/race-rooms/:roomId/sync/queue-diagnostics", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((m) => m.userId === identity.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const q = request.query as { limit?: string };
    const limitParsed = z.coerce.number().int().min(1).max(DIAGNOSTICS_CAP).safeParse(q.limit ?? "20");
    const limit = limitParsed.success ? limitParsed.data : 20;

    const state = getOrInitWs5(roomId);
    const rows = state.diagnostics.slice(-limit);
    return reply.send({ diagnostics: rows });
  });

  app.post("/race-rooms/:roomId/sync/merge-records", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }

    const membership = room.memberships.find((m) => m.userId === identity.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    if (!canRecordMergeTelemetry(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = mergeRecordInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid merge record payload" });
    }

    const now = new Date().toISOString();
    const record: MergeRecord = {
      id: randomUUID(),
      roomId,
      deviceId: parsed.data.deviceId,
      conflictKey: parsed.data.conflictKey,
      strategy: parsed.data.strategy,
      decidedByUserId: identity.sub,
      recordedAt: now,
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {})
    };

    const state = getOrInitWs5(roomId);
    state.mergeRecords.push(record);
    if (state.mergeRecords.length > MERGE_RECORDS_CAP) {
      state.mergeRecords.splice(0, state.mergeRecords.length - MERGE_RECORDS_CAP);
    }

    return reply.code(201).send({ mergeRecord: record });
  });

  app.get("/race-rooms/:roomId/sync/merge-records", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((m) => m.userId === identity.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const q = request.query as { limit?: string };
    const limitParsed = z.coerce.number().int().min(1).max(MERGE_RECORDS_CAP).safeParse(q.limit ?? "20");
    const limit = limitParsed.success ? limitParsed.data : 20;

    const state = getOrInitWs5(roomId);
    const rows = state.mergeRecords.slice(-limit);
    return reply.send({ mergeRecords: rows });
  });
}
