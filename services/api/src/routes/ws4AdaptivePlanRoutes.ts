import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  ExplainabilityRecord,
  IncidentEvent,
  PlanDelta,
  PlanVersion,
  RaceCourseCheckpoint,
  RaceRoom,
  Recommendation,
  Role
} from "@crewcue/contracts";
import { evaluateEntitlement, getRaceRoom } from "./raceRooms.js";

const submitIncidentInput = z.object({
  category: z.enum(["fuel", "hydration", "aid_duration", "equipment", "protocol_deviation", "other"]),
  severity: z.enum(["low", "medium", "high"]),
  checkpointId: z.string().min(1).optional(),
  summary: z.string().trim().min(1).max(500),
  details: z.string().trim().max(5_000).optional(),
  recordedAt: z.iso.datetime().optional()
});

type Ws4RoomState = {
  incidents: IncidentEvent[];
  recommendations: Recommendation[];
  explainability: ExplainabilityRecord[];
  planVersions: PlanVersion[];
};

const ws4RoomState = new Map<string, Ws4RoomState>();

function getOrInitWs4(roomId: string): Ws4RoomState {
  let state = ws4RoomState.get(roomId);
  if (!state) {
    state = { incidents: [], recommendations: [], explainability: [], planVersions: [] };
    ws4RoomState.set(roomId, state);
  }
  return state;
}

function canDecideRecommendations(role: Role): boolean {
  return role === "crew_chief" || role === "team_manager" || role === "athlete";
}

function validateCheckpointId(room: RaceRoom, checkpointId: string | undefined): { ok: true } | { ok: false; error: string } {
  if (checkpointId === undefined) {
    return { ok: true };
  }
  if (!room.course) {
    return { ok: false, error: "Room has no course; omit checkpointId" };
  }
  if (!room.course.checkpoints.some((cp: RaceCourseCheckpoint) => cp.id === checkpointId)) {
    return { ok: false, error: "Unknown checkpointId for this room course" };
  }
  return { ok: true };
}

function buildDeterministicRecommendation(incident: IncidentEvent): { rationale: string; proposedSummary: string; factors: string[] } {
  const factors = [
    `Incident category: ${incident.category}`,
    `Severity: ${incident.severity}`,
    `Reported summary: ${incident.summary}`
  ];
  return {
    rationale: `Deterministic WS4 stub: adjust the forward plan to mitigate ${incident.category} (${incident.severity}).`,
    proposedSummary: `Increase monitoring for ${incident.category} on the next segment; confirm nutrition/hydration targets at the next planned stop.`,
    factors
  };
}

export async function ws4AdaptivePlanRoutes(app: FastifyInstance): Promise<void> {
  app.post("/race-rooms/:roomId/incidents", async (request, reply) => {
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

    const parsed = submitIncidentInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid incident payload" });
    }

    const checkpointCheck = validateCheckpointId(room, parsed.data.checkpointId);
    if (!checkpointCheck.ok) {
      return reply.code(400).send({ error: checkpointCheck.error });
    }

    const now = new Date().toISOString();
    const recordedAt = parsed.data.recordedAt ?? now;
    const incident: IncidentEvent = {
      id: randomUUID(),
      roomId,
      category: parsed.data.category,
      severity: parsed.data.severity,
      ...(parsed.data.checkpointId !== undefined ? { checkpointId: parsed.data.checkpointId } : {}),
      summary: parsed.data.summary,
      ...(parsed.data.details !== undefined ? { details: parsed.data.details } : {}),
      reportedByUserId: identity.sub,
      recordedAt
    };

    const state = getOrInitWs4(roomId);
    state.incidents.push(incident);
    return reply.code(201).send({ incident });
  });

  app.get("/race-rooms/:roomId/incidents", async (request, reply) => {
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

    const state = getOrInitWs4(roomId);
    const incidents = [...state.incidents].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
    return reply.send({ incidents });
  });

  app.post("/race-rooms/:roomId/incidents/:incidentId/recommendations", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const incidentId = (request.params as { incidentId: string }).incidentId;
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

    const state = getOrInitWs4(roomId);
    const incident = state.incidents.find((i) => i.id === incidentId);
    if (!incident) {
      return reply.code(404).send({ error: "Incident not found" });
    }

    const pending = state.recommendations.find((r) => r.incidentId === incidentId && r.status === "pending");
    if (pending) {
      return reply.code(409).send({ error: "Pending recommendation already exists for this incident" });
    }

    const now = new Date().toISOString();
    const { rationale, proposedSummary, factors } = buildDeterministicRecommendation(incident);
    const recommendation: Recommendation = {
      id: randomUUID(),
      roomId,
      incidentId,
      rationale,
      proposedSummary,
      status: "pending",
      createdAt: now
    };
    state.recommendations.push(recommendation);

    const explain: ExplainabilityRecord = {
      id: randomUUID(),
      recommendationId: recommendation.id,
      factors,
      createdAt: now
    };
    state.explainability.push(explain);

    return reply.code(201).send({ recommendation, explainability: explain });
  });

  app.get("/race-rooms/:roomId/recommendations/:recommendationId", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const recommendationId = (request.params as { recommendationId: string }).recommendationId;
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

    const state = getOrInitWs4(roomId);
    const recommendation = state.recommendations.find((r) => r.id === recommendationId);
    if (!recommendation) {
      return reply.code(404).send({ error: "Recommendation not found" });
    }

    const explainability = state.explainability.find((e) => e.recommendationId === recommendationId);
    return reply.send({ recommendation, explainability: explainability ?? null });
  });

  app.post("/race-rooms/:roomId/recommendations/:recommendationId/accept", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const recommendationId = (request.params as { recommendationId: string }).recommendationId;
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

    if (!canDecideRecommendations(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const state = getOrInitWs4(roomId);
    const recIndex = state.recommendations.findIndex((r) => r.id === recommendationId);
    if (recIndex === -1) {
      return reply.code(404).send({ error: "Recommendation not found" });
    }

    const rec = state.recommendations[recIndex]!;
    if (rec.status !== "pending") {
      return reply.code(409).send({ error: "Recommendation cannot be accepted from its current state" });
    }

    const now = new Date().toISOString();
    const decidedBy = identity.sub;
    state.recommendations[recIndex] = {
      ...rec,
      status: "accepted",
      decidedAt: now,
      decidedByUserId: decidedBy
    };

    const lastVersion = state.planVersions.reduce<PlanVersion | null>(
      (best, v) => (!best || v.version > best.version ? v : best),
      null
    );
    const nextVersion = lastVersion ? lastVersion.version + 1 : 1;
    const planVersion: PlanVersion = {
      id: randomUUID(),
      roomId,
      version: nextVersion,
      parentVersionId: lastVersion?.id ?? null,
      rationale: rec.rationale,
      createdAt: now,
      acceptedRecommendationId: rec.id
    };
    state.planVersions.push(planVersion);

    return reply.send({ recommendation: state.recommendations[recIndex]!, planVersion });
  });

  app.post("/race-rooms/:roomId/recommendations/:recommendationId/reject", async (request, reply) => {
    const identity = request.identity;
    if (!identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const recommendationId = (request.params as { recommendationId: string }).recommendationId;
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

    if (!canDecideRecommendations(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const state = getOrInitWs4(roomId);
    const recIndex = state.recommendations.findIndex((r) => r.id === recommendationId);
    if (recIndex === -1) {
      return reply.code(404).send({ error: "Recommendation not found" });
    }

    const rec = state.recommendations[recIndex]!;
    if (rec.status !== "pending") {
      return reply.code(409).send({ error: "Recommendation cannot be rejected from its current state" });
    }

    const now = new Date().toISOString();
    state.recommendations[recIndex] = {
      ...rec,
      status: "rejected",
      decidedAt: now,
      decidedByUserId: identity.sub
    };

    return reply.send({ recommendation: state.recommendations[recIndex]! });
  });

  app.get("/race-rooms/:roomId/plan-versions", async (request, reply) => {
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

    const state = getOrInitWs4(roomId);
    const versions = [...state.planVersions].sort((a, b) => a.version - b.version);
    return reply.send({ planVersions: versions });
  });

  app.get("/race-rooms/:roomId/plan-delta", async (request, reply) => {
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

    const q = request.query as { fromVersion?: string; toVersion?: string };
    const fromParsed = z.coerce.number().int().min(1).safeParse(q.fromVersion);
    const toParsed = z.coerce.number().int().min(1).safeParse(q.toVersion);
    if (!fromParsed.success || !toParsed.success) {
      return reply.code(400).send({ error: "fromVersion and toVersion are required positive integers" });
    }

    const fromVersion = fromParsed.data;
    const toVersion = toParsed.data;
    if (fromVersion === toVersion) {
      return reply.code(400).send({ error: "fromVersion and toVersion must differ" });
    }

    const state = getOrInitWs4(roomId);
    const from = state.planVersions.find((v) => v.version === fromVersion);
    const to = state.planVersions.find((v) => v.version === toVersion);
    if (!from || !to) {
      return reply.code(404).send({ error: "Plan version not found" });
    }

    const toRec =
      to.acceptedRecommendationId !== undefined
        ? state.recommendations.find((r) => r.id === to.acceptedRecommendationId)
        : undefined;

    const changes: string[] = [
      `Compare plan v${fromVersion} → v${toVersion}.`,
      `v${fromVersion} rationale: ${from.rationale}`,
      `v${toVersion} rationale: ${to.rationale}`
    ];
    if (toRec) {
      changes.push(`Accepted proposed summary: ${toRec.proposedSummary}`);
    }

    const delta: PlanDelta = {
      roomId,
      fromVersion,
      toVersion,
      changes
    };
    return reply.send({ planDelta: delta });
  });
}
