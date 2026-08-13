import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  beginIdempotentMutation,
  completeIdempotentMutation,
  idempotencyErrorReply,
  releaseIdempotentMutation
} from "../lib/httpIdempotency.js";
import { z } from "zod";
import {
  parseWaypointTags,
  type AthletePingHistoryEntry,
  type AthletePingRejectReason,
  type CheckpointVisit,
  type CheckpointVisitManualData,
  type CheckpointVisitSource,
  type CheckpointPlan,
  type CrewAssignment,
  type CrewTask,
  type CrewTaskStatus,
  type OpsTimelineEvent,
  type ProtocolNote,
  type MapWorkspaceLayer,
  type RaceMapWorkspace,
  type RaceRoom,
  type RaceRoomInvite,
  type RaceCheckpointSplitRow,
  type RaceRoomJoinPreview,
  type RaceRoomProjection,
  type RaceRoomProjectionCore,
  type RaceCourse,
  type RaceCourseCheckpoint,
  type Role,
  type WaypointTag
} from "@crewcue/contracts";
import {
  buildDerivedMetricsFromPolyline,
  buildPlanBaselineFromModel,
  checkpointsWithProjectedDistances,
  flattenWorkspaceGeometry,
  mergePrimaryCourseRouteLayer,
  normalizeRaceMapWorkspace,
  PRIMARY_COURSE_ROUTE_LAYER_ID,
  workspaceGeometryToBaseline,
  type CourseMetricPoint
} from "@crewcue/map-core";
import {
  hasUsableBaselineTrack,
  type ProjectionPing,
  recomputeRaceProjection
} from "../lib/raceProjection.js";
import { attachProjectionTimeliness } from "../lib/projectionTimeliness.js";
import {
  deleteTaskBoardPayload,
  deleteTaskBoardSnapshot,
  deleteWs2RuntimePayload,
  deleteWs4AdaptivePayload,
  deleteWs5SyncPayload,
  initRoomPersistence,
  isRoomPersistenceEnabled,
  listPersistedRaceRoomsByTeamId,
  listPersistedRaceRoomsForMember,
  isJoinCodeTakenInDb,
  listPersistedRoomsForRetention,
  loadRoomIdByJoinCode,
  loadRaceRoom,
  loadRaceRoomInvite,
  loadTaskBoardPayload,
  loadTaskBoardPayloadVersion,
  loadTaskBoardSnapshot,
  loadWs2RuntimePayload,
  persistRaceRoom,
  persistRaceRoomInvite,
  persistTaskBoardPayload,
  persistTaskBoardSnapshot,
  persistWs2RuntimePayload
} from "../lib/roomPersistence.js";
import { syncRaceRoomStreamChannelMembers } from "../lib/streamChannelMembers.js";

function scheduleStreamChannelMembershipSync(room: RaceRoom, log: FastifyBaseLogger): void {
  void syncRaceRoomStreamChannelMembers(room, log).catch((err) =>
    log.warn({ err, roomId: room.id }, "stream channel membership sync failed (non-fatal)")
  );
}

const createRaceRoomInput = z.object({
  teamId: z.string().min(1),
  athleteId: z.string().min(1),
  name: z.string().min(1),
  creatorName: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  crewName: z.string().trim().optional(),
  creatorRole: z.enum(["athlete", "crew_member", "crew_chief", "team_manager"]).default("athlete")
});

const raceCourseCheckpointCutoffInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("time_of_day"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  }),
  z.object({
    mode: z.literal("elapsed_from_start"),
    seconds: z.number().int().min(0).max(864_000)
  })
]);

/**
 * Closed waypoint tags (`aid` | `water` | `dropbag` | `crew`). Tags have no clock semantics;
 * lat/lng stay degrees and distances stay meters. Empty list = untagged landmark. Invalid
 * strings are rejected (no silent coerce).
 */
const waypointTagsInput = z.unknown().transform((value, ctx): WaypointTag[] => {
  try {
    return parseWaypointTags(value);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : "Invalid tags"
    });
    return z.NEVER;
  }
});

const raceCourseCheckpointInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  distanceMetersFromStart: z.number().finite().nonnegative().optional(),
  plannedStopSeconds: z.number().nonnegative().optional(),
  stoppageRadiusMeters: z.number().positive().optional(),
  slowdownThresholdRatio: z.number().positive().max(1).optional(),
  cutoff: raceCourseCheckpointCutoffInput.optional(),
  tags: waypointTagsInput.optional()
});

const patchRaceCheckpointInput = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    tags: waypointTagsInput.optional()
  })
  .refine((value) => value.title !== undefined || value.tags !== undefined, {
    message: "Provide title and/or tags"
  });

const postRaceCheckpointInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  tags: waypointTagsInput.optional()
});

const COURSE_ROUTE_LINE_REQUIRED_ERROR =
  "Upload a GPX, JSON, or KML track with a full route line, or save the map workspace with a projection driving layer on a layer that contains the course polyline. Checkpoint-only courses are not supported.";

const raceCourseBaselinePointInput = z.object({
  distanceMetersFromStart: z.number().finite().gte(0),
  referenceElapsedSeconds: z.number().finite().gte(0),
  elevationMeters: z.number().finite().optional()
});

const raceCourseBaselineTrackInput = z.object({
  points: z.array(raceCourseBaselinePointInput).min(2)
});

const raceCourseDerivedMetricsInput = z.object({
  canonicalDistanceMeters: z.number().finite().nonnegative(),
  elevationGainMeters: z.number().finite().nonnegative(),
  elevationLossMeters: z.number().finite().nonnegative(),
  elevationSource: z.enum(["gpx_smoothed", "dem", "none"]),
  metricsVersion: z.number().int().positive()
});

const raceCourseInput = z.object({
  checkpoints: z.array(raceCourseCheckpointInput).min(2),
  baselineTrack: raceCourseBaselineTrackInput.optional(),
  derivedMetrics: raceCourseDerivedMetricsInput.optional()
});

const mapWorkspacePosition = z.union([
  z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]),
  z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90), z.number().finite()])
]);

const mapWorkspaceLineStringGeometryInput = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(mapWorkspacePosition).min(2)
});

const mapWorkspaceMultiLineStringGeometryInput = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(mapWorkspacePosition).min(2)).min(1)
});

const mapWorkspaceGeometryInput = z.union([
  mapWorkspaceLineStringGeometryInput,
  mapWorkspaceMultiLineStringGeometryInput
]);

const mapWorkspaceLayerInput = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  visible: z.boolean(),
  sourceFileName: z.string().trim().max(500).optional(),
  strokeColor: z.string().trim().max(32).optional(),
  geometry: mapWorkspaceGeometryInput
});

const updateRaceCourseInput = z.object({
  course: raceCourseInput,
  plannedPaceSecondsPerKm: z.number().positive(),
  courseDistanceMeters: z.number().finite().nonnegative().optional(),
  courseElevationGainMeters: z.number().finite().nonnegative().optional(),
  courseFileName: z.string().trim().min(1).optional(),
  routeOverlayLayer: mapWorkspaceLayerInput.optional(),
  /** Required: official race clock anchor for projection / Pace (ISO datetime). */
  raceStartAt: z.iso.datetime()
});

const putRaceMapWorkspaceInput = z.object({
  layers: z.array(mapWorkspaceLayerInput).max(24),
  selectedLayerId: z.string().optional(),
  drivesProjectionLayerId: z.string().optional(),
  checkpoints: z.array(raceCourseCheckpointInput),
  syncBaselineFromLayer: z.boolean().optional()
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

const joinRaceRoomByCodeInput = z.object({
  roomCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit room code")
});

const updateRaceRoomMemberRoleInput = z.object({
  role: z.enum(["athlete", "crew_member", "crew_chief", "team_manager"])
});

const updateRaceRoomMemberDisplayNameInput = z
  .object({
    displayName: z.string().trim().min(1).max(120)
  })
  .strict();

const ingestAthletePingInput = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  recordedAt: z.iso.datetime(),
  horizontalAccuracyMeters: z.number().positive().optional(),
  uploadIntervalSeconds: z.number().int().min(10).max(900).optional()
});

const manualCheckpointStopInput = z.object({
  arrivalAt: z.iso.datetime(),
  departureAt: z.iso.datetime(),
  note: z.string().trim().max(2_000).optional()
});

const checkpointVisitResolvedSourceInput = z.object({
  resolvedSource: z.enum(["auto", "manual_crew"])
});

const raceRooms = new Map<string, RaceRoom>();
const raceRoomInvites = new Map<string, RaceRoomInvite>();
/** Maps 6-digit join code -> internal room UUID. */
const joinCodeToRoomId = new Map<string, string>();

function indexJoinCode(room: RaceRoom): void {
  if (room.joinCode && /^\d{6}$/.test(room.joinCode)) {
    joinCodeToRoomId.set(room.joinCode, room.id);
  }
}

function unindexJoinCodeForRoomId(roomId: string): void {
  for (const [code, id] of joinCodeToRoomId.entries()) {
    if (id === roomId) {
      joinCodeToRoomId.delete(code);
    }
  }
}

async function randomSixDigitJoinCode(): Promise<string> {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

async function generateUniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = await randomSixDigitJoinCode();
    if (joinCodeToRoomId.has(candidate)) {
      continue;
    }
    const takenInMemory = [...raceRooms.values()].some((r) => r.joinCode === candidate);
    if (takenInMemory) {
      continue;
    }
    if (await isJoinCodeTakenInDb(candidate)) {
      continue;
    }
    return candidate;
  }
  throw new Error("Could not allocate unique join code");
}

async function resolveStorageRoomId(input: string): Promise<string | undefined> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^\d{6}$/.test(trimmed)) {
    const mapped = joinCodeToRoomId.get(trimmed);
    if (mapped) {
      return mapped;
    }
    for (const room of raceRooms.values()) {
      if (room.joinCode === trimmed) {
        return room.id;
      }
    }
    if (isRoomPersistenceEnabled()) {
      const id = await loadRoomIdByJoinCode(trimmed);
      if (id) {
        joinCodeToRoomId.set(trimmed, id);
        return id;
      }
    }
    return undefined;
  }
  return trimmed;
}

async function saveRaceRoom(room: RaceRoom): Promise<void> {
  unindexJoinCodeForRoomId(room.id);
  raceRooms.set(room.id, room);
  indexJoinCode(room);
  await persistRaceRoom(room);
}

async function ensureJoinCodeBackfill(room: RaceRoom): Promise<RaceRoom> {
  if (room.joinCode && /^\d{6}$/.test(room.joinCode)) {
    indexJoinCode(room);
    return room;
  }
  const code = await generateUniqueJoinCode();
  const updated: RaceRoom = { ...room, joinCode: code };
  await saveRaceRoom(updated);
  return updated;
}

async function saveRaceRoomInvite(invite: RaceRoomInvite): Promise<void> {
  raceRoomInvites.set(invite.token, invite);
  await persistRaceRoomInvite(invite);
}

export async function getRaceRoom(roomIdOrCode: string): Promise<RaceRoom | undefined> {
  const resolvedId = await resolveStorageRoomId(roomIdOrCode);
  if (!resolvedId) {
    return undefined;
  }
  let room = raceRooms.get(resolvedId);
  if (!room) {
    room = await loadRaceRoom(resolvedId);
    if (room) {
      raceRooms.set(resolvedId, room);
    }
  }
  if (!room) {
    return undefined;
  }
  return ensureJoinCodeBackfill(room);
}

async function getRaceRoomInvite(token: string): Promise<RaceRoomInvite | undefined> {
  const cached = raceRoomInvites.get(token);
  if (cached) {
    return cached;
  }
  const loaded = await loadRaceRoomInvite(token);
  if (loaded) {
    raceRoomInvites.set(token, loaded);
  }
  return loaded;
}

function toJoinPreview(room: RaceRoom): RaceRoomJoinPreview {
  const members = room.memberships.map((member) => ({
    displayName: member.displayName?.trim() || `Member ${member.userId.slice(0, 6)}`,
    role: member.role
  }));
  return {
    roomName: room.name,
    joinCode: room.joinCode ?? "",
    status: room.status,
    memberCount: members.length,
    members,
    courseDistanceMeters: room.courseDistanceMeters,
    courseElevationGainMeters: room.courseElevationGainMeters,
    plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
    courseFileName: room.courseFileName,
    baselineTrack: room.course?.baselineTrack,
    checkpoints: room.course?.checkpoints.map((cp) => ({
      id: cp.id,
      latitude: cp.latitude,
      longitude: cp.longitude,
      ...(cp.title ? { title: cp.title } : {})
    }))
  };
}

const JOIN_PREVIEW_RATE_WINDOW_MS = 60_000;
const JOIN_PREVIEW_RATE_LIMIT = 20;
const joinPreviewRateState = new Map<string, { count: number; windowStartedAtMs: number }>();

function readRequestIp(request: { ip?: string }): string {
  return typeof request.ip === "string" && request.ip.trim().length > 0 ? request.ip.trim() : "unknown";
}

function isJoinPreviewRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = joinPreviewRateState.get(ip);
  if (!existing || now - existing.windowStartedAtMs > JOIN_PREVIEW_RATE_WINDOW_MS) {
    joinPreviewRateState.set(ip, { count: 1, windowStartedAtMs: now });
    return false;
  }
  const next = { ...existing, count: existing.count + 1 };
  joinPreviewRateState.set(ip, next);
  return next.count > JOIN_PREVIEW_RATE_LIMIT;
}

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
  visitStates: Record<
    string,
    Array<{
      arrivalRecordedAt: string | null;
      departureRecordedAt: string | null;
      firstSlowedAt: string | null;
      accumulatedStopSeconds: number;
    }>
  >;
  visitMeta: Record<
    string,
    Array<{
      visitIndex: number;
      resolvedSource: CheckpointVisitSource;
      manualEntry?: CheckpointVisitManualData;
      note?: string;
    }>
  >;
  rollingMovingSpeedMps: number;
  lastProjectionCore: RaceRoomProjectionCore;
};

const roomProjectionState = new Map<string, RoomProjectionState>();

const ws2RuntimeHydratedFromDb = new Set<string>();

function isAcceptedPingPayload(x: unknown): x is AcceptedPing {
  if (!x || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.pingId === "string" &&
    typeof o.latitude === "number" &&
    typeof o.longitude === "number" &&
    typeof o.recordedAtMs === "number" &&
    typeof o.receivedAtMs === "number"
  );
}

function normalizeWs2RuntimePayload(raw: unknown): { ping?: RoomPingState; projection?: RoomProjectionState } {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const rec = raw as Record<string, unknown>;
  let ping: RoomPingState | undefined;
  if (rec.ping && typeof rec.ping === "object") {
    const p = rec.ping as Record<string, unknown>;
    if (Array.isArray(p.history)) {
      ping = {
        lastAccepted: isAcceptedPingPayload(p.lastAccepted) ? p.lastAccepted : null,
        history: p.history as AthletePingHistoryEntry[],
        ...(typeof p.lastUploadIntervalSeconds === "number"
          ? { lastUploadIntervalSeconds: p.lastUploadIntervalSeconds }
          : {})
      };
    }
  }
  let projection: RoomProjectionState | undefined;
  if (rec.projection && typeof rec.projection === "object") {
    const pr = rec.projection as Record<string, unknown>;
    if (
      typeof pr.lastProgressMeters === "number" &&
      pr.splitCrossedAt &&
      typeof pr.splitCrossedAt === "object" &&
      pr.lastProjectionCore &&
      typeof pr.lastProjectionCore === "object"
    ) {
      projection = {
        lastProgressMeters: pr.lastProgressMeters,
        splitCrossedAt: { ...(pr.splitCrossedAt as Record<string, string>) },
        visitStates: (pr.visitStates as RoomProjectionState["visitStates"]) ?? {},
        visitMeta: (pr.visitMeta as RoomProjectionState["visitMeta"]) ?? {},
        rollingMovingSpeedMps:
          typeof pr.rollingMovingSpeedMps === "number" ? pr.rollingMovingSpeedMps : 0,
        lastProjectionCore: pr.lastProjectionCore as RaceRoomProjectionCore
      };
    }
  }
  return { ping, projection };
}

async function loadWs2RuntimeIfNeeded(roomId: string): Promise<void> {
  if (!isRoomPersistenceEnabled()) {
    return;
  }
  if (ws2RuntimeHydratedFromDb.has(roomId)) {
    return;
  }
  ws2RuntimeHydratedFromDb.add(roomId);
  const raw = await loadWs2RuntimePayload(roomId);
  const { ping, projection } = normalizeWs2RuntimePayload(raw);
  if (ping) {
    roomPingState.set(roomId, ping);
  }
  if (projection) {
    roomProjectionState.set(roomId, projection);
  }
}

async function saveWs2RuntimeSnapshot(roomId: string): Promise<void> {
  if (!isRoomPersistenceEnabled()) {
    return;
  }
  const ping =
    roomPingState.get(roomId) ??
    ({
      lastAccepted: null,
      history: []
    } satisfies RoomPingState);
  const projection = roomProjectionState.get(roomId);
  await persistWs2RuntimePayload(roomId, {
    ping,
    ...(projection !== undefined ? { projection } : {})
  });
}

/** Race clock anchor: prefer `raceStartAt`, fall back to legacy `activatedAt`. */
export function resolveRaceAnchorIso(room: RaceRoom): string | undefined {
  const fromRaceStart = room.raceStartAt?.trim();
  if (fromRaceStart) {
    return fromRaceStart;
  }
  const fromActivated = room.activatedAt?.trim();
  return fromActivated || undefined;
}

/**
 * When course + pace + anchor exist but no projection state yet (no accepted ping),
 * seed in-memory (and persisted) projection at the course start.
 */
async function ensureBootstrapProjection(roomId: string, room: RaceRoom, persistSnapshot: boolean): Promise<boolean> {
  const anchor = resolveRaceAnchorIso(room);
  if (!room.course || room.plannedPaceSecondsPerKm === undefined || !anchor) {
    return false;
  }
  if (roomProjectionState.has(roomId)) {
    return true;
  }
  const origin = room.course.checkpoints[0];
  if (!origin) {
    return false;
  }
  const pingId = "bootstrap";
  const recordedAt = new Date().toISOString();
  const ping: ProjectionPing = {
    pingId,
    latitude: origin.latitude,
    longitude: origin.longitude,
    recordedAt
  };
  const routeMetricPoints = resolveRouteMetricPointsFromRaceRoom(room);
  if (!routeMetricPoints) {
    return false;
  }
  try {
    const { projection: nextProjectionCore, state } = recomputeRaceProjection({
      roomId,
      activatedAt: anchor,
      course: room.course,
      plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
      ping,
      previousPing: null,
      previous: null,
      routeMetricPoints,
      canonicalCourseLengthMeters: room.courseDistanceMeters
    });
    roomProjectionState.set(roomId, {
      lastProgressMeters: state.lastProgressMeters,
      splitCrossedAt: { ...state.splitCrossedAt },
      visitStates: structuredClone(state.visitStates),
      visitMeta: structuredClone(state.visitMeta),
      rollingMovingSpeedMps: state.rollingMovingSpeedMps,
      lastProjectionCore: nextProjectionCore
    });
    if (persistSnapshot) {
      await saveWs2RuntimeSnapshot(roomId);
    }
    return true;
  } catch {
    return false;
  }
}

type TaskBoardMaterializedPayload = {
  checkpointPlans: CheckpointPlan[];
  tasks: CrewTask[];
  assignments: CrewAssignment[];
  protocolNotes: ProtocolNote[];
  timelineEvents: OpsTimelineEvent[];
};

type RoomTaskBoardState = TaskBoardMaterializedPayload & {
  version: number;
};

type PersistedTaskBoardRecord = {
  version: number;
  board: TaskBoardMaterializedPayload;
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

function createTaskBoardState(payload: TaskBoardMaterializedPayload, version: number): RoomTaskBoardState {
  return {
    checkpointPlans: payload.checkpointPlans,
    tasks: payload.tasks,
    assignments: payload.assignments,
    protocolNotes: payload.protocolNotes,
    timelineEvents: payload.timelineEvents,
    version: Number.isInteger(version) && version > 0 ? version : 1
  };
}

function toTaskBoardPayload(board: RoomTaskBoardState): TaskBoardMaterializedPayload {
  return {
    checkpointPlans: board.checkpointPlans,
    tasks: board.tasks,
    assignments: board.assignments,
    protocolNotes: board.protocolNotes,
    timelineEvents: board.timelineEvents
  };
}

function buildInitialTaskBoard(room: RaceRoom): RoomTaskBoardState {
  if (!room.course) {
    return {
      checkpointPlans: [],
      tasks: [],
      assignments: [],
      protocolNotes: [],
      timelineEvents: [],
      version: 1
    };
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

  return { checkpointPlans, tasks, assignments, protocolNotes: [], timelineEvents: [], version: 1 };
}

function normalizeTaskBoardMaterializedPayload(raw: unknown): TaskBoardMaterializedPayload | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  if (
    !Array.isArray(rec.checkpointPlans) ||
    !Array.isArray(rec.tasks) ||
    !Array.isArray(rec.assignments) ||
    !Array.isArray(rec.protocolNotes)
  ) {
    return undefined;
  }
  return {
    checkpointPlans: rec.checkpointPlans as CheckpointPlan[],
    tasks: rec.tasks as CrewTask[],
    assignments: rec.assignments as CrewAssignment[],
    protocolNotes: rec.protocolNotes as ProtocolNote[],
    timelineEvents: Array.isArray(rec.timelineEvents) ? (rec.timelineEvents as OpsTimelineEvent[]) : []
  };
}

function normalizeTaskBoardPayload(raw: unknown): RoomTaskBoardState | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const persistedBoard = normalizeTaskBoardMaterializedPayload(rec.board);
  if (persistedBoard) {
    const version = typeof rec.version === "number" ? rec.version : 1;
    return createTaskBoardState(persistedBoard, version);
  }
  const legacyBoard = normalizeTaskBoardMaterializedPayload(raw);
  if (!legacyBoard) {
    return undefined;
  }
  return createTaskBoardState(legacyBoard, 1);
}

async function refreshTaskBoardSnapshot(roomId: string, board: RoomTaskBoardState): Promise<void> {
  await persistTaskBoardSnapshot({
    aggregateId: roomId,
    version: board.version,
    payload: toTaskBoardPayload(board)
  });
}

async function getOrInitTaskBoard(room: RaceRoom): Promise<RoomTaskBoardState> {
  const cached = roomTaskBoardState.get(room.id);
  if (cached) {
    return cached;
  }

  const snapshot = await loadTaskBoardSnapshot(room.id);
  if (snapshot) {
    const parsedSnapshot = normalizeTaskBoardPayload({
      version: snapshot.version,
      board: snapshot.payload
    });
    if (parsedSnapshot) {
      const persistedVersion = await loadTaskBoardPayloadVersion(room.id);
      if (persistedVersion === undefined || persistedVersion <= parsedSnapshot.version) {
        roomTaskBoardState.set(room.id, parsedSnapshot);
        return parsedSnapshot;
      }
    }
  }

  const raw = await loadTaskBoardPayload(room.id);
  const parsed = normalizeTaskBoardPayload(raw);
  if (parsed) {
    roomTaskBoardState.set(room.id, parsed);
    await refreshTaskBoardSnapshot(room.id, parsed);
    return parsed;
  }

  const built = buildInitialTaskBoard(room);
  await saveTaskBoard(room.id, built);
  return built;
}

async function saveTaskBoard(roomId: string, board: RoomTaskBoardState): Promise<void> {
  roomTaskBoardState.set(roomId, board);
  await persistTaskBoardPayload(
    roomId,
    {
      version: board.version,
      board: toTaskBoardPayload(board)
    } satisfies PersistedTaskBoardRecord
  );
  await refreshTaskBoardSnapshot(roomId, board);
}

function bumpTaskBoardVersion(board: RoomTaskBoardState): void {
  board.version += 1;
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

export function clearTaskBoardLocalState(roomId: string): void {
  roomTaskBoardState.delete(roomId);
}

async function pushPingHistory(roomId: string, entry: AthletePingHistoryEntry): Promise<void> {
  const state = getOrInitPingState(roomId);
  state.history.push(entry);
  if (state.history.length > PING_HISTORY_CAP) {
    state.history.splice(0, state.history.length - PING_HISTORY_CAP);
  }
  await saveWs2RuntimeSnapshot(roomId);
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
  /** Course upload, race start anchor, entitlement updates (replaces legacy activate permission). */
  canEditRaceSetup: boolean;
  canIssueInvite: boolean;
  /** Crew stop edits (manual arrival/departure); aligned with `canEditCheckpointStoppage`. */
  canEditCheckpointStops: boolean;
};

function getPermissions(role: Role): PermissionSet {
  const canEditRaceSetup = role === "athlete" || role === "crew_chief" || role === "team_manager";
  const canIssueInvite = role === "athlete" || role === "crew_chief" || role === "team_manager";
  return {
    canViewRoom: true,
    canEditRaceSetup,
    canIssueInvite,
    canEditCheckpointStops: canEditCheckpointStoppage(role)
  };
}

function canEditCheckpointStoppage(role: Role): boolean {
  return role === "crew_member" || role === "crew_chief" || role === "team_manager";
}

function refreshCheckpointVisitDerivedFields(visit: CheckpointVisit): void {
  visit.activeActualStopSeconds =
    visit.resolvedSource === "manual_crew"
      ? (visit.manualEntry?.actualStopSeconds ?? null)
      : (visit.autoDetected?.actualStopSeconds ?? null);
}

function refreshCheckpointSplitStoppageDerivedFields(
  split: RaceRoomProjectionCore["checkpointSplits"][number]
): void {
  for (const visit of split.visits) {
    refreshCheckpointVisitDerivedFields(visit);
  }
  split.totalActualStopSeconds = split.visits.reduce<number | null>((acc, visit) => {
    if (visit.activeActualStopSeconds === null) {
      return acc;
    }
    return (acc ?? 0) + visit.activeActualStopSeconds;
  }, null);
  split.deltaStopSeconds =
    split.totalActualStopSeconds === null ? null : split.totalActualStopSeconds - split.plannedStopSeconds;
}

function getTaskBoardVisibleRoles(role: Role): Role[] {
  if (role === "crew_member") {
    return ["crew_member"];
  }
  return ["athlete", "crew_member", "crew_chief", "team_manager"];
}

export function evaluateEntitlement(app: FastifyInstance, room: RaceRoom, actor: string): { allowed: boolean; code?: number; error?: string } {
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

/** All race rooms for a team id (WS6 aggregate scope). */
export async function listRaceRoomsByTeamId(teamId: string): Promise<RaceRoom[]> {
  const local = [...raceRooms.values()].filter((r) => r.teamId === teamId);
  if (!isRoomPersistenceEnabled()) {
    return local;
  }
  const persisted = await listPersistedRaceRoomsByTeamId(teamId);
  for (const room of persisted) {
    raceRooms.set(room.id, room);
    indexJoinCode(room);
  }
  const merged = new Map<string, RaceRoom>();
  for (const room of [...persisted, ...local]) {
    merged.set(room.id, room);
  }
  return [...merged.values()];
}

export async function listRaceRoomsForMember(userId: string): Promise<RaceRoom[]> {
  const local = [...raceRooms.values()].filter((r) => r.memberships.some((m) => m.userId === userId));
  if (!isRoomPersistenceEnabled()) {
    const sorted = local.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return Promise.all(sorted.map((r) => ensureJoinCodeBackfill(r)));
  }
  const persisted = await listPersistedRaceRoomsForMember(userId);
  for (const room of persisted) {
    raceRooms.set(room.id, room);
    indexJoinCode(room);
  }
  const merged = new Map<string, RaceRoom>();
  for (const room of [...persisted, ...local]) {
    merged.set(room.id, room);
  }
  const sorted = [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return Promise.all(sorted.map((r) => ensureJoinCodeBackfill(r)));
}

/**
 * All rooms that have an `eventEndsAt` set. Used by the chat retention
 * scheduler to find rooms whose chat data should be purged after the
 * 30-day retention window. Returns a minimal projection.
 */
export async function listRaceRoomsForRetention(): Promise<
  Array<Pick<RaceRoom, "id" | "eventEndsAt" | "status">>
> {
  if (!isRoomPersistenceEnabled()) {
    return [...raceRooms.values()]
      .filter((r) => typeof r.eventEndsAt === "string" && r.eventEndsAt.length > 0)
      .map((r) => ({ id: r.id, eventEndsAt: r.eventEndsAt, status: r.status }));
  }
  return listPersistedRoomsForRetention();
}

/** Latest projection view with timeliness, when ping history produced a stored core projection or bootstrap filled state. */
export async function getProjectionViewForRoom(roomId: string): Promise<RaceRoomProjection | undefined> {
  await loadWs2RuntimeIfNeeded(roomId);
  let stored = roomProjectionState.get(roomId);
  if (!stored) {
    const room = await getRaceRoom(roomId);
    if (room) {
      await ensureBootstrapProjection(roomId, room, true);
      stored = roomProjectionState.get(roomId);
    }
  }
  if (!stored) {
    return undefined;
  }
  const pingState = getOrInitPingState(roomId);
  return attachProjectionTimeliness(
    stored.lastProjectionCore,
    pingState.lastAccepted?.recordedAtMs ?? null,
    Date.now(),
    pingState.lastUploadIntervalSeconds
  );
}

function checkpointSplitHasVisitLog(split: RaceCheckpointSplitRow): boolean {
  return split.visits.some((visit) => {
    if (visit.manualEntry) {
      return true;
    }
    return Boolean(visit.autoDetected?.departureRecordedAt);
  });
}

function visitedCheckpointIdsFromStoredProjection(stored: RoomProjectionState): Set<string> {
  const ids = new Set<string>();
  for (const row of stored.lastProjectionCore.checkpointSplits) {
    if (checkpointSplitHasVisitLog(row)) {
      ids.add(row.checkpointId);
    }
  }
  return ids;
}

function pruneProjectionStateMaps(
  state: Pick<RoomProjectionState, "splitCrossedAt" | "visitStates" | "visitMeta" | "lastProgressMeters" | "rollingMovingSpeedMps">,
  allowedCheckpointIds: Set<string>
): Pick<RoomProjectionState, "splitCrossedAt" | "visitStates" | "visitMeta" | "lastProgressMeters" | "rollingMovingSpeedMps"> {
  return {
    lastProgressMeters: state.lastProgressMeters,
    rollingMovingSpeedMps: state.rollingMovingSpeedMps,
    splitCrossedAt: Object.fromEntries(Object.entries(state.splitCrossedAt).filter(([id]) => allowedCheckpointIds.has(id))),
    visitStates: Object.fromEntries(Object.entries(state.visitStates).filter(([id]) => allowedCheckpointIds.has(id))),
    visitMeta: Object.fromEntries(Object.entries(state.visitMeta).filter(([id]) => allowedCheckpointIds.has(id)))
  };
}

async function recomputeStoredProjectionAfterCourseChange(roomId: string, room: RaceRoom): Promise<void> {
  const anchor = resolveRaceAnchorIso(room);
  if (!anchor || !room.course || room.plannedPaceSecondsPerKm === undefined) {
    return;
  }
  const pingState = getOrInitPingState(roomId);
  if (!pingState.lastAccepted) {
    return;
  }
  const routeMetricPoints = resolveRouteMetricPointsFromRaceRoom(room);
  if (!routeMetricPoints) {
    roomProjectionState.delete(roomId);
    return;
  }
  const prev = roomProjectionState.get(roomId);
  const last = pingState.lastAccepted;
  const ping: ProjectionPing = {
    pingId: last.pingId,
    latitude: last.latitude,
    longitude: last.longitude,
    recordedAt: new Date(last.recordedAtMs).toISOString()
  };
  const previous = prev
    ? {
        lastProgressMeters: prev.lastProgressMeters,
        splitCrossedAt: { ...prev.splitCrossedAt },
        visitStates: structuredClone(prev.visitStates),
        visitMeta: structuredClone(prev.visitMeta),
        rollingMovingSpeedMps: prev.rollingMovingSpeedMps
      }
    : null;
  const { projection: nextProjectionCore, state: nextStateRaw } = recomputeRaceProjection({
    roomId,
    activatedAt: anchor,
    course: room.course,
    plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
    ping,
    previousPing: null,
    previous,
    routeMetricPoints,
    canonicalCourseLengthMeters: room.courseDistanceMeters
  });
  const allowed = new Set(room.course.checkpoints.map((c) => c.id));
  const prunedBase = pruneProjectionStateMaps(nextStateRaw, allowed);
  roomProjectionState.set(roomId, {
    ...prunedBase,
    lastProjectionCore: nextProjectionCore
  });
}

/** Task status counts for manager-style boards (not role-filtered). */
export async function getTaskStatusCountsForRoom(room: RaceRoom): Promise<Record<CrewTaskStatus, number>> {
  const board = await getOrInitTaskBoard(room);
  const counts: Record<CrewTaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0
  };
  for (const task of board.tasks) {
    counts[task.status] += 1;
  }
  return counts;
}

export type InProgressAssignmentRow = {
  assigneeUserId: string;
  roomId: string;
  taskId: string;
  checkpointId: string;
};

/** Assignments for tasks currently marked in progress (WS6 staffing overlap input). */
export async function listInProgressAssignmentsForRoom(room: RaceRoom): Promise<InProgressAssignmentRow[]> {
  const board = await getOrInitTaskBoard(room);
  const rows: InProgressAssignmentRow[] = [];
  for (const task of board.tasks) {
    if (task.status !== "in_progress") {
      continue;
    }
    const assignment = assignmentForTask(board, task.id);
    if (!assignment) {
      continue;
    }
    rows.push({
      assigneeUserId: assignment.assigneeUserId,
      roomId: room.id,
      taskId: task.id,
      checkpointId: task.checkpointId
    });
  }
  return rows;
}

/** Checkpoints with pending or in-progress crew demand (WS6 heatmap input). */
export async function listActiveDemandCheckpointsForRoom(room: RaceRoom): Promise<string[]> {
  const board = await getOrInitTaskBoard(room);
  const ids = new Set<string>();
  for (const task of board.tasks) {
    if (task.status === "pending" || task.status === "in_progress") {
      ids.add(task.checkpointId);
    }
  }
  return [...ids];
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

function recomputeProjectionStoppageSummary(core: RaceRoomProjectionCore, activatedAt: string): void {
  const asOfMs = Date.parse(core.asOfRecordedAt);
  const activatedAtMs = Date.parse(activatedAt);
  const completedRows = core.checkpointSplits.filter((row) =>
    row.visits.some((visit) => {
      if (visit.resolvedSource === "manual_crew") {
        return visit.manualEntry !== undefined;
      }
      return (
        visit.autoDetected?.departureRecordedAt !== null &&
        visit.autoDetected?.departureRecordedAt !== undefined
      );
    })
  );
  const totalPlannedStopSeconds = core.checkpointSplits.reduce((sum, row) => sum + row.plannedStopSeconds, 0);
  const totalActualStopSeconds = completedRows.reduce(
    (sum, row) => sum + row.visits.reduce((vsum, visit) => vsum + (visit.activeActualStopSeconds ?? 0), 0),
    0
  );
  const completedPlannedStopSeconds = completedRows.reduce((sum, row) => sum + row.plannedStopSeconds, 0);
  const raceElapsedSeconds =
    Number.isFinite(asOfMs) && Number.isFinite(activatedAtMs) ? Math.max(0, (asOfMs - activatedAtMs) / 1000) : 0;
  core.stoppageSummary = {
    totalPlannedStopSeconds,
    totalActualStopSeconds,
    totalDeltaStopSeconds:
      completedRows.length > 0 ? totalActualStopSeconds - completedPlannedStopSeconds : null,
    stoppageTimePercent:
      completedRows.length > 0 && raceElapsedSeconds > 0
        ? (totalActualStopSeconds / raceElapsedSeconds) * 100
        : null,
    remainingPlannedStopSeconds: core.checkpointSplits.reduce(
      (sum, row) => sum + (row.visits.length === 0 ? row.plannedStopSeconds : 0),
      0
    )
  };
}

function syncProjectionAccumulatorStateFromCore(state: RoomProjectionState): void {
  const nextVisitStates: RoomProjectionState["visitStates"] = {};
  const nextVisitMeta: RoomProjectionState["visitMeta"] = {};
  for (const row of state.lastProjectionCore.checkpointSplits) {
    if (row.visits.length === 0) {
      continue;
    }
    nextVisitStates[row.checkpointId] = row.visits.map((visit) => ({
      arrivalRecordedAt: visit.autoDetected?.arrivalRecordedAt ?? null,
      departureRecordedAt: visit.autoDetected?.departureRecordedAt ?? null,
      firstSlowedAt: visit.autoDetected?.firstSlowedAt ?? null,
      accumulatedStopSeconds: visit.autoDetected?.actualStopSeconds ?? 0
    }));
    nextVisitMeta[row.checkpointId] = row.visits.map((visit) => ({
      visitIndex: visit.visitIndex,
      resolvedSource: visit.resolvedSource,
      ...(visit.manualEntry ? { manualEntry: visit.manualEntry } : {}),
      ...(visit.note ? { note: visit.note } : {})
    }));
  }
  state.visitStates = nextVisitStates;
  state.visitMeta = nextVisitMeta;
}

function resolveMapWorkspace(room: RaceRoom): RaceMapWorkspace {
  if (room.mapWorkspace) {
    return room.mapWorkspace;
  }
  return {
    layers: [],
    checkpoints: room.course?.checkpoints ? room.course.checkpoints.map((checkpoint) => ({ ...checkpoint })) : []
  };
}

/** Full route polyline for projection / course metrics; null if missing or degenerate. */
function resolveRouteMetricPointsFromRaceRoom(room: RaceRoom): CourseMetricPoint[] | null {
  const ws = resolveMapWorkspace(room);
  const id = ws.drivesProjectionLayerId ?? PRIMARY_COURSE_ROUTE_LAYER_ID;
  const layer = ws.layers.find((l) => l.id === id);
  if (!layer) {
    return null;
  }
  const pts = courseMetricPointsFromGeometry(layer.geometry);
  return pts.length >= 2 ? pts : null;
}

/** Route for PUT /course: prefer new overlay, else existing workspace driving layer. */
function resolveRouteMetricPointsForCoursePut(
  room: RaceRoom,
  routeOverlayLayer: MapWorkspaceLayer | undefined
): CourseMetricPoint[] | null {
  if (routeOverlayLayer) {
    const pts = courseMetricPointsFromGeometry(routeOverlayLayer.geometry);
    return pts.length >= 2 ? pts : null;
  }
  return resolveRouteMetricPointsFromRaceRoom(room);
}

function courseMetricPointsFromGeometry(geometry: MapWorkspaceLayer["geometry"]): Array<{
  latitude: number;
  longitude: number;
  elevationMeters?: number | null;
}> {
  return flattenWorkspaceGeometry(geometry).map((coord) => {
    const tuple = coord as [number, number, number?];
    return {
      longitude: tuple[0],
      latitude: tuple[1],
      elevationMeters: typeof tuple[2] === "number" && Number.isFinite(tuple[2]) ? tuple[2] : null
    };
  });
}

function recomputeCourseMetricsForSave(input: {
  course: RaceCourse;
  plannedPaceSecondsPerKm: number;
  routeMetricPoints?: CourseMetricPoint[];
}): RaceCourse {
  if (input.course.checkpoints.length < 2) {
    return { ...input.course };
  }
  if (!input.routeMetricPoints || input.routeMetricPoints.length < 2) {
    throw new Error("route_metric_points_required");
  }
  const checkpoints = checkpointsWithProjectedDistances(input.course.checkpoints, input.routeMetricPoints);
  const derivedMetrics = buildDerivedMetricsFromPolyline(input.routeMetricPoints);
  const canonicalLen = derivedMetrics.canonicalDistanceMeters;
  const fromModel = buildPlanBaselineFromModel(input.routeMetricPoints, input.plannedPaceSecondsPerKm);
  const baselineTrack =
    input.course.baselineTrack && hasUsableBaselineTrack(input.course.baselineTrack, canonicalLen)
      ? input.course.baselineTrack
      : fromModel ?? input.course.baselineTrack;
  return {
    ...input.course,
    checkpoints,
    ...(baselineTrack ? { baselineTrack } : {}),
    derivedMetrics
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
      return inner;
    }
    return Object.keys(inner)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (inner as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

function courseDependentStateFingerprint(input: {
  course: RaceCourse | undefined;
  plannedPaceSecondsPerKm: number | undefined;
  courseFileName: string | undefined;
}): string {
  return stableStringify({
    course: input.course ?? null,
    plannedPaceSecondsPerKm: input.plannedPaceSecondsPerKm ?? null,
    courseFileName: input.courseFileName ?? null
  });
}

function syncWorkspaceCheckpoints(room: RaceRoom, checkpoints: RaceCourseCheckpoint[]): RaceRoom {
  if (!room.mapWorkspace) {
    return room;
  }
  return {
    ...room,
    mapWorkspace: {
      ...room.mapWorkspace,
      checkpoints
    }
  };
}

async function requireCourseEditor(
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
  if (!getPermissions(membership.role).canEditRaceSetup) {
    await reply.code(403).send({ error: "Insufficient permissions" });
    return undefined;
  }
  const entitlement = evaluateEntitlement(app, room, request.identity.sub);
  if (!entitlement.allowed) {
    await reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    return undefined;
  }
  return room;
}

function rebuildRoomCourseFromCheckpoints(
  room: RaceRoom,
  checkpoints: RaceCourseCheckpoint[]
): { ok: true; room: RaceRoom } | { ok: false; error: string } {
  if (!room.course || room.plannedPaceSecondsPerKm === undefined) {
    return { ok: false, error: COURSE_ROUTE_LINE_REQUIRED_ERROR };
  }
  const routePts = resolveRouteMetricPointsFromRaceRoom(room);
  if (!routePts) {
    return { ok: false, error: COURSE_ROUTE_LINE_REQUIRED_ERROR };
  }
  let recomputedCourse: RaceCourse;
  try {
    recomputedCourse = recomputeCourseMetricsForSave({
      course: { ...room.course, checkpoints },
      plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
      routeMetricPoints: routePts
    });
  } catch {
    return { ok: false, error: "Course route data is invalid or could not be processed." };
  }
  const updatedRoom: RaceRoom = {
    ...room,
    course: recomputedCourse,
    courseDistanceMeters: recomputedCourse.derivedMetrics?.canonicalDistanceMeters ?? room.courseDistanceMeters,
    courseElevationGainMeters: recomputedCourse.derivedMetrics?.elevationGainMeters ?? room.courseElevationGainMeters,
    courseElevationLossMeters: recomputedCourse.derivedMetrics?.elevationLossMeters ?? room.courseElevationLossMeters
  };
  return { ok: true, room: syncWorkspaceCheckpoints(updatedRoom, recomputedCourse.checkpoints) };
}

async function persistCourseShapeChange(
  app: FastifyInstance,
  roomId: string,
  previousRoom: RaceRoom,
  updatedRoom: RaceRoom
): Promise<void> {
  const nextCourse = updatedRoom.course;
  const nextPace = updatedRoom.plannedPaceSecondsPerKm;
  if (nextCourse && nextPace !== undefined) {
    const shouldResetCourseDependentState = courseDependentStateNeedsReset({
      previousRoom,
      nextCourse,
      nextPlannedPaceSecondsPerKm: nextPace,
      nextCourseFileName: updatedRoom.courseFileName,
      routeOverlayLayer: undefined
    });
    if (shouldResetCourseDependentState) {
      clearTaskBoardLocalState(roomId);
      await deleteTaskBoardPayload(roomId);
      await deleteTaskBoardSnapshot(roomId);
      await deleteWs4AdaptivePayload(roomId);
      const { clearWs4RoomLocalState } = await import("./ws4AdaptivePlanRoutes.js");
      clearWs4RoomLocalState(roomId);
      await deleteWs5SyncPayload(roomId);
      const { clearWs5RoomLocalState } = await import("./ws5SyncRoutes.js");
      clearWs5RoomLocalState(roomId);
    }
  }
  await saveRaceRoom(updatedRoom);
  if (!getOrInitPingState(roomId).lastAccepted) {
    roomProjectionState.delete(roomId);
  }
  try {
    await recomputeStoredProjectionAfterCourseChange(roomId, updatedRoom);
  } catch (err) {
    app.log.warn({ err, roomId }, "projection_recompute_after_course_failed");
  }
  await ensureBootstrapProjection(roomId, updatedRoom, true);
  await saveWs2RuntimeSnapshot(roomId);
}

function courseDependentStateNeedsReset(input: {
  previousRoom: RaceRoom;
  nextCourse: RaceCourse;
  nextPlannedPaceSecondsPerKm: number;
  nextCourseFileName: string | undefined;
  routeOverlayLayer: MapWorkspaceLayer | undefined;
}): boolean {
  if (input.routeOverlayLayer) {
    return true;
  }
  const previous = courseDependentStateFingerprint({
    course: input.previousRoom.course,
    plannedPaceSecondsPerKm: input.previousRoom.plannedPaceSecondsPerKm,
    courseFileName: input.previousRoom.courseFileName
  });
  const next = courseDependentStateFingerprint({
    course: input.nextCourse,
    plannedPaceSecondsPerKm: input.nextPlannedPaceSecondsPerKm,
    courseFileName: input.nextCourseFileName
  });
  return previous !== next;
}

function applyRaceMapWorkspacePut(
  room: RaceRoom,
  input: z.infer<typeof putRaceMapWorkspaceInput>
): RaceRoom {
  const base: RaceMapWorkspace = {
    layers: input.layers,
    selectedLayerId: input.selectedLayerId,
    drivesProjectionLayerId: input.drivesProjectionLayerId,
    checkpoints: input.checkpoints
  };
  const normalized = normalizeRaceMapWorkspace(base);
  let next: RaceRoom = { ...room, mapWorkspace: normalized };

  if (normalized.checkpoints.length >= 2) {
    let baselineTrack = room.course?.baselineTrack;
    let derivedMetrics = room.course?.derivedMetrics;
    let checkpoints = normalized.checkpoints;
    const drivingId = normalized.drivesProjectionLayerId;
    if (!drivingId) {
      throw new Error("course_route_driver_layer_required");
    }
    const layer = normalized.layers.find((entry: MapWorkspaceLayer) => entry.id === drivingId);
    if (!layer) {
      throw new Error("course_route_driver_layer_not_found");
    }
    const routePoints = courseMetricPointsFromGeometry(layer.geometry);
    if (routePoints.length < 2) {
      throw new Error("course_route_geometry_insufficient");
    }
    const computed = workspaceGeometryToBaseline(layer.geometry, room.plannedPaceSecondsPerKm);
    if (computed) {
      baselineTrack = computed;
    }
    checkpoints = checkpointsWithProjectedDistances(normalized.checkpoints, routePoints);
    derivedMetrics = buildDerivedMetricsFromPolyline(routePoints);
    next = {
      ...next,
      course: {
        checkpoints,
        ...(baselineTrack ? { baselineTrack } : {}),
        ...(derivedMetrics ? { derivedMetrics } : {})
      },
      ...(derivedMetrics
        ? {
            courseDistanceMeters: derivedMetrics.canonicalDistanceMeters,
            courseElevationGainMeters: derivedMetrics.elevationGainMeters,
            courseElevationLossMeters: derivedMetrics.elevationLossMeters
          }
        : {})
    };
  } else if (room.course && normalized.checkpoints.length > 0) {
    next = {
      ...next,
      course: { ...room.course, checkpoints: normalized.checkpoints }
    };
  }

  return next;
}

export async function setRaceRoomStatusForTests(roomId: string, status: RaceRoom["status"]): Promise<void> {
  const mode = process.env.PERSISTENCE_MODE;
  if (mode !== "memory" && mode !== "postgres") {
    throw new Error(
      `setRaceRoomStatusForTests is test-only; use PERSISTENCE_MODE=memory or postgres (got ${mode ?? "unset"})`
    );
  }
  const room = await getRaceRoom(roomId);
  if (!room) {
    return;
  }
  await saveRaceRoom({ ...room, status });
}

export async function raceRoomRoutes(app: FastifyInstance): Promise<void> {
  await initRoomPersistence(app.log);

  app.post("/race-rooms", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = createRaceRoomInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid race room payload" });
    }

    const idemCreate = await beginIdempotentMutation(request, parsed.data);
    if (idemCreate.kind === "replay") {
      return reply.code(idemCreate.statusCode).send(idemCreate.body);
    }
    if (idemCreate.kind === "conflict" || idemCreate.kind === "in_progress") {
      return idempotencyErrorReply(reply, idemCreate);
    }

    const now = new Date().toISOString();
    const roomId = randomUUID();
    const joinCode = await generateUniqueJoinCode();
    const room: RaceRoom = {
      id: roomId,
      joinCode,
      creatorName: parsed.data.creatorName,
      description: parsed.data.description,
      crewName: parsed.data.crewName,
      teamId: parsed.data.teamId,
      athleteId: parsed.data.athleteId,
      name: parsed.data.name,
      status: "active",
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

    try {
      await saveRaceRoom(room);
      scheduleStreamChannelMembershipSync(room, request.log);
      await completeIdempotentMutation(request, parsed.data, 201, room);
      return reply.code(201).send(room);
    } catch (err) {
      await releaseIdempotentMutation(request, parsed.data);
      throw err;
    }
  });

  app.get("/race-rooms/mine", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const rooms = await listRaceRoomsForMember(request.identity.sub);
    return reply.send({ rooms });
  });

  app.get("/race-rooms/join-preview/:roomCode", async (request, reply) => {
    const roomCode = ((request.params as { roomCode?: string }).roomCode ?? "").trim();
    if (!/^\d{6}$/.test(roomCode)) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const ip = readRequestIp(request);
    if (isJoinPreviewRateLimited(ip)) {
      return reply.code(429).send({ error: "Too many requests" });
    }
    const room = await getRaceRoom(roomCode);
    if (!room || room.joinCode !== roomCode) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    return reply.send({ preview: toJoinPreview(room) });
  });

  app.get("/race-rooms/:roomId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

  app.put("/race-rooms/:roomId/course", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const permissions = getPermissions(membership.role);
    if (!permissions.canEditRaceSetup) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = updateRaceCourseInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid course payload" });
    }

    const idemCourse = await beginIdempotentMutation(request, parsed.data);
    if (idemCourse.kind === "replay") {
      return reply.code(idemCourse.statusCode).send(idemCourse.body);
    }
    if (idemCourse.kind === "conflict" || idemCourse.kind === "in_progress") {
      return idempotencyErrorReply(reply, idemCourse);
    }

    let idemCourseFinished = false;
    try {
    await loadWs2RuntimeIfNeeded(roomId);
    const prevProjection = roomProjectionState.get(roomId);
    if (prevProjection) {
      const visitedIds = visitedCheckpointIdsFromStoredProjection(prevProjection);
      const nextIds = new Set(parsed.data.course.checkpoints.map((c) => c.id));
      for (const id of visitedIds) {
        if (!nextIds.has(id)) {
          return reply.code(400).send({ error: `Cannot remove visited checkpoint: ${id}` });
        }
      }
    }

    let recomputedCourse: RaceCourse;
    if (parsed.data.course.checkpoints.length >= 2) {
      const routePts = resolveRouteMetricPointsForCoursePut(room, parsed.data.routeOverlayLayer);
      if (!routePts) {
        return reply.code(400).send({
          error: COURSE_ROUTE_LINE_REQUIRED_ERROR
        });
      }
      try {
        recomputedCourse = recomputeCourseMetricsForSave({
          course: parsed.data.course,
          plannedPaceSecondsPerKm: parsed.data.plannedPaceSecondsPerKm,
          routeMetricPoints: routePts
        });
      } catch (err) {
        request.log.warn({ err, roomId }, "course_metrics_recompute_failed");
        return reply.code(400).send({ error: "Course route data is invalid or could not be processed." });
      }
    } else {
      recomputedCourse = recomputeCourseMetricsForSave({
        course: parsed.data.course,
        plannedPaceSecondsPerKm: parsed.data.plannedPaceSecondsPerKm
      });
    }

    let updatedRoom: RaceRoom = {
      ...room,
      course: recomputedCourse,
      plannedPaceSecondsPerKm: parsed.data.plannedPaceSecondsPerKm,
      courseDistanceMeters: recomputedCourse.derivedMetrics?.canonicalDistanceMeters ?? room.courseDistanceMeters,
      courseElevationGainMeters: recomputedCourse.derivedMetrics?.elevationGainMeters ?? room.courseElevationGainMeters,
      courseElevationLossMeters: recomputedCourse.derivedMetrics?.elevationLossMeters ?? room.courseElevationLossMeters,
      courseFileName: parsed.data.courseFileName ?? room.courseFileName,
      raceStartAt: parsed.data.raceStartAt,
      activatedAt: parsed.data.raceStartAt
    };

    if (parsed.data.routeOverlayLayer) {
      const mergedWorkspace = mergePrimaryCourseRouteLayer(
        resolveMapWorkspace(updatedRoom),
        parsed.data.routeOverlayLayer,
        recomputedCourse.checkpoints
      );
      updatedRoom = { ...updatedRoom, mapWorkspace: mergedWorkspace };
    }

    const shouldResetCourseDependentState = courseDependentStateNeedsReset({
      previousRoom: room,
      nextCourse: recomputedCourse,
      nextPlannedPaceSecondsPerKm: parsed.data.plannedPaceSecondsPerKm,
      nextCourseFileName: updatedRoom.courseFileName,
      routeOverlayLayer: parsed.data.routeOverlayLayer
    });
    if (shouldResetCourseDependentState) {
      clearTaskBoardLocalState(roomId);
      await deleteTaskBoardPayload(roomId);
      await deleteTaskBoardSnapshot(roomId);
      await deleteWs4AdaptivePayload(roomId);
      const { clearWs4RoomLocalState } = await import("./ws4AdaptivePlanRoutes.js");
      clearWs4RoomLocalState(roomId);
      await deleteWs5SyncPayload(roomId);
      const { clearWs5RoomLocalState } = await import("./ws5SyncRoutes.js");
      clearWs5RoomLocalState(roomId);
    }

      await saveRaceRoom(updatedRoom);
      if (!getOrInitPingState(roomId).lastAccepted) {
        roomProjectionState.delete(roomId);
      }
      try {
        await recomputeStoredProjectionAfterCourseChange(roomId, updatedRoom);
      } catch (err) {
        app.log.warn({ err, roomId }, "projection_recompute_after_course_failed");
      }
      await ensureBootstrapProjection(roomId, updatedRoom, true);
      await saveWs2RuntimeSnapshot(roomId);
      await completeIdempotentMutation(request, parsed.data, 200, updatedRoom);
      idemCourseFinished = true;
      return reply.send(updatedRoom);
    } finally {
      if (!idemCourseFinished) {
        await releaseIdempotentMutation(request, parsed.data);
      }
    }
  });

  app.post("/race-rooms/:roomId/checkpoints", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await requireCourseEditor(app, request, reply, roomId);
    if (!room) {
      return;
    }

    const parsed = postRaceCheckpointInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid checkpoint payload" });
    }

    if (!room.course) {
      return reply.code(400).send({ error: COURSE_ROUTE_LINE_REQUIRED_ERROR });
    }
    if (room.course.checkpoints.some((checkpoint) => checkpoint.id === parsed.data.id)) {
      return reply.code(400).send({ error: `Checkpoint already exists: ${parsed.data.id}` });
    }

    const nextCheckpoint: RaceCourseCheckpoint = {
      id: parsed.data.id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {})
    };
    const rebuilt = rebuildRoomCourseFromCheckpoints(room, [...room.course.checkpoints, nextCheckpoint]);
    if (!rebuilt.ok) {
      return reply.code(400).send({ error: rebuilt.error });
    }
    await persistCourseShapeChange(app, roomId, room, rebuilt.room);
    return reply.code(201).send(rebuilt.room);
  });

  app.patch("/race-rooms/:roomId/checkpoints/:checkpointId", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const checkpointId = (request.params as { checkpointId: string }).checkpointId;
    const room = await requireCourseEditor(app, request, reply, roomId);
    if (!room) {
      return;
    }

    const parsed = patchRaceCheckpointInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid checkpoint payload" });
    }

    const existing = room.course?.checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
    if (!room.course || !existing) {
      return reply.code(404).send({ error: "Checkpoint not found" });
    }

    const nextCheckpoints = room.course.checkpoints.map((checkpoint) => {
      if (checkpoint.id !== checkpointId) {
        return checkpoint;
      }
      return {
        ...checkpoint,
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {})
      };
    });
    const updatedRoom = syncWorkspaceCheckpoints(
      { ...room, course: { ...room.course, checkpoints: nextCheckpoints } },
      nextCheckpoints
    );
    await saveRaceRoom(updatedRoom);
    return reply.send(updatedRoom);
  });

  app.delete("/race-rooms/:roomId/checkpoints/:checkpointId", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const checkpointId = (request.params as { checkpointId: string }).checkpointId;
    const room = await requireCourseEditor(app, request, reply, roomId);
    if (!room) {
      return;
    }

    if (!room.course) {
      return reply.code(404).send({ error: "Checkpoint not found" });
    }
    if (!room.course.checkpoints.some((checkpoint) => checkpoint.id === checkpointId)) {
      return reply.code(404).send({ error: "Checkpoint not found" });
    }

    await loadWs2RuntimeIfNeeded(roomId);
    const prevProjection = roomProjectionState.get(roomId);
    if (prevProjection) {
      const visitedIds = visitedCheckpointIdsFromStoredProjection(prevProjection);
      if (visitedIds.has(checkpointId)) {
        return reply.code(400).send({ error: `Cannot remove visited checkpoint: ${checkpointId}` });
      }
    }

    const remaining = room.course.checkpoints.filter((checkpoint) => checkpoint.id !== checkpointId);
    if (remaining.length < 2) {
      return reply.code(400).send({ error: "Course must retain at least two checkpoints" });
    }

    const rebuilt = rebuildRoomCourseFromCheckpoints(room, remaining);
    if (!rebuilt.ok) {
      return reply.code(400).send({ error: rebuilt.error });
    }
    await persistCourseShapeChange(app, roomId, room, rebuilt.room);
    return reply.send(rebuilt.room);
  });

  app.get("/race-rooms/:roomId/map-workspace", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    return reply.send({ mapWorkspace: resolveMapWorkspace(room) });
  });

  app.put("/race-rooms/:roomId/map-workspace", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const permissions = getPermissions(membership.role);
    if (!permissions.canEditRaceSetup) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }

    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const parsed = putRaceMapWorkspaceInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid map workspace payload" });
    }

    let updatedRoom: RaceRoom;
    try {
      updatedRoom = applyRaceMapWorkspacePut(room, parsed.data);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (
        code === "course_route_driver_layer_required" ||
        code === "course_route_driver_layer_not_found" ||
        code === "course_route_geometry_insufficient"
      ) {
        return reply.code(400).send({
          error:
            "With two or more checkpoints, set drivesProjectionLayerId to a layer whose geometry is a full course line (at least two vertices)."
        });
      }
      throw err;
    }

    roomPingState.delete(roomId);
    roomProjectionState.delete(roomId);
    ws2RuntimeHydratedFromDb.delete(roomId);
    clearTaskBoardLocalState(roomId);
    await deleteWs2RuntimePayload(roomId);
    await deleteTaskBoardPayload(roomId);
    await deleteTaskBoardSnapshot(roomId);
    await deleteWs4AdaptivePayload(roomId);
    const { clearWs4RoomLocalState } = await import("./ws4AdaptivePlanRoutes.js");
    clearWs4RoomLocalState(roomId);
    await deleteWs5SyncPayload(roomId);
    const { clearWs5RoomLocalState } = await import("./ws5SyncRoutes.js");
    clearWs5RoomLocalState(roomId);

    await saveRaceRoom(updatedRoom);
    return reply.send(updatedRoom);
  });

  app.post("/race-rooms/:roomId/invites", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    await saveRaceRoomInvite(invite);
    return reply.code(201).send({
      token: invite.token,
      roomId: invite.roomId,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt
    });
  });

  app.get("/race-rooms/:roomId/invites", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const now = Date.now();
    const invites = [...raceRoomInvites.values()]
      .filter((invite) => invite.roomId === roomId)
      .map((invite) => {
        if (invite.status === "pending" && Date.parse(invite.expiresAt) <= now) {
          return { ...invite, status: "expired" as const };
        }
        return invite;
      })
      .sort((a, b) => Date.parse(b.invitedAt) - Date.parse(a.invitedAt));

    await Promise.all(
      invites
        .filter((invite) => invite.status === "expired")
        .map((invite) => saveRaceRoomInvite(invite))
    );

    return reply.send({ invites });
  });

  app.post("/race-rooms/:roomId/invites/accept", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const parsed = acceptInviteInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid invite acceptance payload" });
    }

    const invite = await getRaceRoomInvite(parsed.data.token);
    if (!invite || invite.roomId !== roomId) {
      return reply.code(404).send({ error: "Invite not found" });
    }

    if (invite.status !== "pending") {
      return reply.code(409).send({ error: "Invite is not pending" });
    }

    if (isExpired(invite.expiresAt)) {
      await saveRaceRoomInvite({ ...invite, status: "expired" });
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

    await saveRaceRoom(updatedRoom);
    await saveRaceRoomInvite({
      ...invite,
      status: "accepted",
      acceptedBy: request.identity.sub,
      acceptedAt: new Date().toISOString()
    });
    scheduleStreamChannelMembershipSync(updatedRoom, request.log);

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

  app.post("/race-rooms/join-by-code", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = joinRaceRoomByCodeInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid room join payload" });
    }

    const room = await getRaceRoom(parsed.data.roomCode);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const existingMembership = room.memberships.find((member) => member.userId === request.identity?.sub);
    const nextMemberships = existingMembership
      ? room.memberships
      : [
          ...room.memberships,
          {
            userId: request.identity.sub,
            role: "crew_member" as const,
            joinedAt: new Date().toISOString()
          }
        ];

    const updatedRoom: RaceRoom = {
      ...room,
      memberships: nextMemberships
    };

    if (!existingMembership) {
      await saveRaceRoom(updatedRoom);
      scheduleStreamChannelMembershipSync(updatedRoom, request.log);
    }

    const assignedMembership = updatedRoom.memberships.find((member) => member.userId === request.identity?.sub);
    if (!assignedMembership) {
      return reply.code(500).send({ error: "Membership assignment failed" });
    }

    return reply.send({
      room: updatedRoom,
      assignedRole: assignedMembership.role,
      permissions: getPermissions(assignedMembership.role)
    });
  });

  app.patch("/race-rooms/:roomId/members/:memberUserId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { roomId, memberUserId } = request.params as { roomId: string; memberUserId: string };
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const targetMember = room.memberships.find((member) => member.userId === memberUserId);
    if (!targetMember) {
      return reply.code(404).send({ error: "Member not found" });
    }

    const nameParsed = updateRaceRoomMemberDisplayNameInput.safeParse(request.body);
    if (nameParsed.success) {
      if (memberUserId !== request.identity.sub) {
        return reply.code(403).send({ error: "You can only update your own display name" });
      }
      const trimmed = nameParsed.data.displayName.trim();
      let updatedRoom: RaceRoom = {
        ...room,
        memberships: room.memberships.map((member) =>
          member.userId === memberUserId ? { ...member, displayName: trimmed } : member
        )
      };
      if (memberUserId === room.athleteId) {
        updatedRoom = { ...updatedRoom, creatorName: trimmed };
      }
      await saveRaceRoom(updatedRoom);
      const updatedMembership = updatedRoom.memberships.find((member) => member.userId === memberUserId);
      if (!updatedMembership) {
        return reply.code(500).send({ error: "Could not update display name" });
      }
      return reply.send({ room: updatedRoom, membership: updatedMembership });
    }

    if (room.athleteId !== request.identity.sub) {
      return reply.code(403).send({ error: "Only the race owner can manage room members" });
    }

    const parsed = updateRaceRoomMemberRoleInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid member update payload" });
    }

    if (targetMember.userId === room.athleteId && parsed.data.role !== "athlete") {
      return reply.code(409).send({ error: "Race owner role cannot be changed from athlete" });
    }

    const updatedRoom: RaceRoom = {
      ...room,
      memberships: room.memberships.map((member) =>
        member.userId === memberUserId ? { ...member, role: parsed.data.role } : member
      )
    };
    await saveRaceRoom(updatedRoom);
    const updatedMembership = updatedRoom.memberships.find((member) => member.userId === memberUserId);
    if (!updatedMembership) {
      return reply.code(500).send({ error: "Could not update member role" });
    }
    return reply.send({ room: updatedRoom, membership: updatedMembership });
  });

  app.delete("/race-rooms/:roomId/members/:memberUserId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { roomId, memberUserId } = request.params as { roomId: string; memberUserId: string };
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (room.athleteId !== request.identity.sub) {
      return reply.code(403).send({ error: "Only the race owner can manage room members" });
    }
    if (memberUserId === room.athleteId) {
      return reply.code(409).send({ error: "Race owner cannot be removed from room" });
    }

    const hasMember = room.memberships.some((member) => member.userId === memberUserId);
    if (!hasMember) {
      return reply.code(404).send({ error: "Member not found" });
    }

    const updatedRoom: RaceRoom = {
      ...room,
      memberships: room.memberships.filter((member) => member.userId !== memberUserId)
    };
    await saveRaceRoom(updatedRoom);
    scheduleStreamChannelMembershipSync(updatedRoom, request.log);
    return reply.send({ room: updatedRoom });
  });

  app.get("/teams/:teamId/race-rooms", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const teamId = (request.params as { teamId: string }).teamId;
    const identityTeamIds = request.identity.teamIds;
    const canListTeam =
      identityTeamIds.includes(teamId) ||
      (identityTeamIds.length === 0 && teamId === "mobile-ops-team");
    if (!canListTeam) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const rooms = await listRaceRoomsByTeamId(teamId);
    const visibleRooms = rooms
      .filter((room) => room.memberships.some((member) => member.userId === request.identity?.sub))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return reply.send({ rooms: visibleRooms });
  });

  app.post("/race-rooms/:roomId/entitlement", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const permissions = getPermissions(membership.role);
    if (!permissions.canEditRaceSetup) {
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

    await saveRaceRoom(updated);
    return reply.send(updated.entitlement);
  });

  app.post("/race-rooms/:roomId/pings", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    await loadWs2RuntimeIfNeeded(roomId);

    const parsed = ingestAthletePingInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ping payload" });
    }

    const body = parsed.data;
    const receivedAt = new Date().toISOString();
    const receivedAtMs = Date.parse(receivedAt);
    const recordedAtMs = Date.parse(body.recordedAt);

    const reject = async (reason: AthletePingRejectReason, message: string) => {
      const entry: AthletePingHistoryEntry = {
        id: randomUUID(),
        at: receivedAt,
        actor: request.identity!.sub,
        decision: "rejected",
        reason
      };
      await pushPingHistory(roomId, entry);
      app.log.info(
        { ping_decision: { roomId, actor: request.identity!.sub, decision: "rejected", reason } },
        "ping_decision"
      );
      return reply.code(422).send({ decision: "rejected" as const, reason, message });
    };

    if (room.status !== "active") {
      return await reject("room_not_active", "Race room must be active to ingest pings");
    }

    if (body.horizontalAccuracyMeters !== undefined && body.horizontalAccuracyMeters > MAX_HORIZONTAL_ACCURACY_M) {
      return await reject("accuracy_too_poor", "Horizontal accuracy exceeds allowed threshold");
    }

    if (Number.isNaN(recordedAtMs)) {
      return reply.code(400).send({ error: "Invalid ping payload" });
    }

    if (Math.abs(receivedAtMs - recordedAtMs) > MAX_CLOCK_SKEW_MS) {
      return await reject("clock_skew", "recordedAt is too far from server time");
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
          return await reject("implausible_motion", "Movement exceeds plausible speed for elapsed time");
        }
      }
    }

    const pingId = randomUUID();
    const previousAccepted = pingState.lastAccepted;
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
    await pushPingHistory(roomId, acceptedEntry);

    app.log.info(
      { ping_decision: { roomId, actor: request.identity.sub, decision: "accepted", pingId } },
      "ping_decision"
    );

    let projection: RaceRoomProjection | undefined;
    const raceAnchor = resolveRaceAnchorIso(room);
    if (room.course && room.plannedPaceSecondsPerKm !== undefined && raceAnchor) {
      const routeMetricPoints = resolveRouteMetricPointsFromRaceRoom(room);
      if (!routeMetricPoints) {
        roomProjectionState.delete(roomId);
        app.log.warn({ roomId }, "projection_skipped_missing_route_layer");
      } else {
        const prev = roomProjectionState.get(roomId);
        try {
          const { projection: nextProjectionCore, state } = recomputeRaceProjection({
            roomId,
            activatedAt: raceAnchor,
            course: room.course,
            plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
            ping: {
              pingId,
              latitude: body.latitude,
              longitude: body.longitude,
              recordedAt: body.recordedAt
            },
            previousPing: previousAccepted
              ? {
                  pingId: previousAccepted.pingId,
                  latitude: previousAccepted.latitude,
                  longitude: previousAccepted.longitude,
                  recordedAt: new Date(previousAccepted.recordedAtMs).toISOString()
                }
              : null,
            previous: prev
              ? {
                  lastProgressMeters: prev.lastProgressMeters,
                  splitCrossedAt: { ...prev.splitCrossedAt },
                  visitStates: structuredClone(prev.visitStates),
                  visitMeta: structuredClone(prev.visitMeta),
                  rollingMovingSpeedMps: prev.rollingMovingSpeedMps
                }
              : null,
            routeMetricPoints,
            canonicalCourseLengthMeters: room.courseDistanceMeters
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
          visitStates: structuredClone(state.visitStates),
          visitMeta: structuredClone(state.visitMeta),
          rollingMovingSpeedMps: state.rollingMovingSpeedMps,
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
    }

    await saveWs2RuntimeSnapshot(roomId);

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
    const room = await getRaceRoom(roomId);
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

    await loadWs2RuntimeIfNeeded(roomId);

    let stored = roomProjectionState.get(roomId);
    if (!stored) {
      await ensureBootstrapProjection(roomId, room, true);
      stored = roomProjectionState.get(roomId);
    }
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

  app.post("/race-rooms/:roomId/checkpoints/:cpId/manual-stop", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const roomId = (request.params as { roomId: string }).roomId;
    const checkpointId = (request.params as { cpId: string }).cpId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!canEditCheckpointStoppage(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }
    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }
    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }
    if (!room.course || !room.course.checkpoints.some((cp) => cp.id === checkpointId)) {
      return reply.code(404).send({ error: "Unknown checkpointId for this room course" });
    }
    const parsed = manualCheckpointStopInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid manual stop payload" });
    }

    const idemManualStop = await beginIdempotentMutation(request, parsed.data);
    if (idemManualStop.kind === "replay") {
      return reply.code(idemManualStop.statusCode).send(idemManualStop.body);
    }
    if (idemManualStop.kind === "conflict" || idemManualStop.kind === "in_progress") {
      return idempotencyErrorReply(reply, idemManualStop);
    }

    let idemManualStopFinished = false;
    try {
    await loadWs2RuntimeIfNeeded(roomId);
    const projectionState = roomProjectionState.get(roomId);
    const raceAnchor = resolveRaceAnchorIso(room);
    if (!projectionState || !raceAnchor) {
      return reply.code(409).send({ error: "Projection state unavailable" });
    }
    const split = projectionState.lastProjectionCore.checkpointSplits.find((row) => row.checkpointId === checkpointId);
    if (!split) {
      return reply.code(404).send({ error: "Checkpoint not found on room course" });
    }
    const arrivalMs = Date.parse(parsed.data.arrivalAt);
    const departureMs = Date.parse(parsed.data.departureAt);
    if (!Number.isFinite(arrivalMs) || !Number.isFinite(departureMs) || departureMs <= arrivalMs) {
      return reply.code(400).send({ error: "departureAt must be after arrivalAt" });
    }
    const manualEntry: CheckpointVisitManualData = {
      arrivalAt: parsed.data.arrivalAt,
      departureAt: parsed.data.departureAt,
      actualStopSeconds: (departureMs - arrivalMs) / 1000,
      recordedByUserId: request.identity.sub
    };
    const overlapVisit =
      split.visits.find(
        (visit) =>
          visit.autoDetected?.arrivalRecordedAt &&
          Date.parse(visit.autoDetected.arrivalRecordedAt) <= departureMs &&
          (visit.autoDetected.departureRecordedAt
            ? Date.parse(visit.autoDetected.departureRecordedAt)
            : Number.POSITIVE_INFINITY) >= arrivalMs
      ) ?? null;
    if (overlapVisit) {
      overlapVisit.manualEntry = manualEntry;
      if (parsed.data.note) {
        overlapVisit.note = parsed.data.note;
      }
      overlapVisit.resolvedSource = "manual_crew";
    } else {
      split.visits.push({
        visitIndex: split.visits.length + 1,
        resolvedSource: "manual_crew",
        manualEntry,
        activeActualStopSeconds: null,
        ...(parsed.data.note ? { note: parsed.data.note } : {})
      });
    }
    refreshCheckpointSplitStoppageDerivedFields(split);
    recomputeProjectionStoppageSummary(projectionState.lastProjectionCore, raceAnchor);
    syncProjectionAccumulatorStateFromCore(projectionState);
      await saveWs2RuntimeSnapshot(roomId);
      const manualStopPayload = { checkpointSplit: split };
      await completeIdempotentMutation(request, parsed.data, 200, manualStopPayload);
      idemManualStopFinished = true;
      return reply.send(manualStopPayload);
    } finally {
      if (!idemManualStopFinished) {
        await releaseIdempotentMutation(request, parsed.data);
      }
    }
  });

  app.patch("/race-rooms/:roomId/checkpoints/:cpId/visits/:visitIndex/resolved-source", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const roomId = (request.params as { roomId: string }).roomId;
    const checkpointId = (request.params as { cpId: string }).cpId;
    const visitIndexParsed = z.coerce.number().int().min(1).safeParse((request.params as { visitIndex: string }).visitIndex);
    if (!visitIndexParsed.success) {
      return reply.code(400).send({ error: "Invalid visitIndex" });
    }
    const visitIndex = visitIndexParsed.data;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const membership = room.memberships.find((member) => member.userId === request.identity?.sub);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!canEditCheckpointStoppage(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }
    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }
    if (room.status !== "active") {
      return reply.code(409).send({ error: "Race room must be active" });
    }
    if (!room.course || !room.course.checkpoints.some((cp) => cp.id === checkpointId)) {
      return reply.code(404).send({ error: "Unknown checkpointId for this room course" });
    }
    const parsed = checkpointVisitResolvedSourceInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid resolved source payload" });
    }
    await loadWs2RuntimeIfNeeded(roomId);
    const projectionState = roomProjectionState.get(roomId);
    const raceAnchor = resolveRaceAnchorIso(room);
    if (!projectionState || !raceAnchor) {
      return reply.code(409).send({ error: "Projection state unavailable" });
    }
    const split = projectionState.lastProjectionCore.checkpointSplits.find((row) => row.checkpointId === checkpointId);
    if (!split) {
      return reply.code(404).send({ error: "Checkpoint not found on room course" });
    }
    const visit = split.visits.find((v) => v.visitIndex === visitIndex);
    if (!visit) {
      return reply.code(404).send({ error: "Visit not found" });
    }
    if (parsed.data.resolvedSource === "manual_crew" && !visit.manualEntry) {
      return reply.code(400).send({ error: "manual_crew requires manualEntry on the visit" });
    }
    if (parsed.data.resolvedSource === "auto" && !visit.autoDetected) {
      return reply.code(400).send({ error: "auto requires autoDetected on the visit" });
    }
    visit.resolvedSource = parsed.data.resolvedSource;
    refreshCheckpointSplitStoppageDerivedFields(split);
    recomputeProjectionStoppageSummary(projectionState.lastProjectionCore, raceAnchor);
    syncProjectionAccumulatorStateFromCore(projectionState);
    await saveWs2RuntimeSnapshot(roomId);
    return reply.send({ checkpointSplit: split });
  });

  app.get("/race-rooms/:roomId/tasks", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    const board = await getOrInitTaskBoard(room);
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
    const room = await getRaceRoom(roomId);
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

    const board = await getOrInitTaskBoard(room);
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

    bumpTaskBoardVersion(board);
    await saveTaskBoard(roomId, board);
    return reply.send({ task: board.tasks[taskIndex]!, assignment: nextAssignment });
  });

  app.post("/race-rooms/:roomId/tasks/:taskId/start", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const taskId = (request.params as { taskId: string }).taskId;
    const room = await getRaceRoom(roomId);
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

    const board = await getOrInitTaskBoard(room);
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

    bumpTaskBoardVersion(board);
    await saveTaskBoard(roomId, board);
    return reply.send({ task: board.tasks[taskIndex]! });
  });

  app.post("/race-rooms/:roomId/tasks/:taskId/complete", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const taskId = (request.params as { taskId: string }).taskId;
    const room = await getRaceRoom(roomId);
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

    const board = await getOrInitTaskBoard(room);
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

    bumpTaskBoardVersion(board);
    await saveTaskBoard(roomId, board);
    return reply.send({ task: board.tasks[taskIndex]! });
  });

  app.get("/race-rooms/:roomId/protocol-notes", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    const board = await getOrInitTaskBoard(room);
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
    const room = await getRaceRoom(roomId);
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
    const board = await getOrInitTaskBoard(room);
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

    bumpTaskBoardVersion(board);
    await saveTaskBoard(roomId, board);
    return reply.send({ protocolNote: next });
  });

  app.get("/race-rooms/:roomId/timeline", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    const board = await getOrInitTaskBoard(room);
    const events = sortTimelineAscending(board.timelineEvents);
    return reply.send({ events });
  });

  app.get("/race-rooms/:roomId/pings/history", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
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

    await loadWs2RuntimeIfNeeded(roomId);

    const limitRaw = (request.query as { limit?: string }).limit;
    const limitParsed = z.coerce.number().int().min(1).max(50).safeParse(limitRaw ?? "20");
    const limit = limitParsed.success ? limitParsed.data : 20;

    const state = getOrInitPingState(roomId);
    const decisions = state.history.slice(-limit);
    return reply.send({ decisions });
  });
}
