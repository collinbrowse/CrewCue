import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deterministicRaceRoomId } from "../lib/deterministicRaceRoomId.js";
import {
  beginIdempotentMutation,
  completeIdempotentMutation,
  idempotencyErrorReply,
  readIdempotencyKey,
  releaseIdempotentMutation
} from "../lib/httpIdempotency.js";
import { z } from "zod";
import {
  parseWaypointTags,
  type AthletePingHistoryEntry,
  type AthletePingBatchPointResult,
  type AthletePingBatchResponse,
  type AthletePingRejectReason,
  type RaceRoomPingTrackResponse,
  type RaceRoomLatestPingResponse,
  type CheckpointVisit,
  type CheckpointVisitManualData,
  type CheckpointVisitSource,
  type CheckpointPlan,
  type CrewAssignment,
  type CrewTask,
  type CrewTaskStatus,
  type OpsTimelineEvent,
  type PacingEstimate,
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
  geodesicProjectPointToPolyline,
  mergePrimaryCourseRouteLayer,
  normalizeRaceMapWorkspace,
  PRIMARY_COURSE_ROUTE_LAYER_ID,
  workspaceGeometryToBaseline,
  type CourseMetricPoint
} from "@crewcue/map-core";
import {
  hasUsableBaselineTrack,
  nextVisitIndex,
  type ProjectionPing,
  type LiveRatioAccumulator,
  type ProjectionPreviousState,
  recomputeRaceProjection
} from "../lib/raceProjection.js";
import { isProjectionTunedConstantsEnabled } from "../lib/projectionTuning.js";
import { buildFinishedEffort, justFinished } from "../lib/finishedEffort.js";
import { recordFinishedEffort } from "../lib/finishedEffortStore.js";
import { blendWithCohort, cohortForCourse } from "../lib/courseHistory/resolve.js";
import { crewCueRoomToCourseHistoryEvent } from "../lib/courseHistory/sources/crewcueRoom.js";
import { importCourseHistoryEvents } from "../lib/courseHistory/store.js";
import { appendTrackPoints, deleteTrack, existingTrackTimes, listTrackPoints } from "../lib/athletePingTrack.js";
import { computeLiveRemainingProjection } from "../lib/pacingEstimate/microModel/liveRemaining.js";
import { attachProjectionTimeliness, getStalenessThresholdSeconds } from "../lib/projectionTimeliness.js";
import {
  checkPersistedRaceRoomDeleteCondition,
  countPersistedUnpaidRaceRoomsCreatedBy,
  deletePersistedRaceRoomInvite,
  deletePersistedRaceRoomRows,
  deleteTaskBoardPayload,
  deleteTaskBoardSnapshot,
  deleteWs2RuntimePayload,
  initRoomPersistence,
  isRoomPersistenceEnabled,
  listPersistedRaceRoomsByTeamId,
  listPersistedRaceRoomsForAthlete,
  listPersistedRaceRoomsForMember,
  listPersistedRaceRoomsStartingBetween,
  listPersistedUnpaidRaceRoomsCreatedBefore,
  listPersistedUnpaidRaceRoomsForReminders,
  type PersistedRaceRoomDeletion,
  type PersistenceQueryable,
  type RaceRoomExpiryFields,
  type RaceRoomReminderFields,
  type RaceRoomStartFields,
  isJoinCodeTakenInDb,
  listPersistedRoomsForRetention,
  loadRoomIdByJoinCode,
  loadRaceRoom,
  loadRaceRoomInvite,
  loadRaceRoomInvitesForRoom,
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
import { createLazyHydrator } from "../lib/lazyHydrate.js";
import { publishChatRoom } from "../lib/chatLive.js";
import { clearRoomRemoval, recordRoomRemoval, roomRemovedAt } from "../lib/roomRemovalStore.js";
import { notifyEntitledMembersOfCheckInEtaShift } from "../lib/checkInEtaNotify.js";
import {
  countsTowardUnpaidRaceLimit,
  crewLimitError,
  isCrewMembership,
  isRoomPaid,
  isRunnerSeat,
  raceCreatorOf,
  roomUnpaidError,
  unpaidRaceLimitError
} from "../lib/billingEntitlement.js";
import {
  ensureBillingStoreReady,
  listRoomIdsWithBillingGrants,
  listUserIdsWithUnattachedBillingGrants
} from "../lib/billingStore.js";
import { forgetTrackingRemindersForRoom } from "../lib/trackingReminderScheduler.js";
import {
  forgetUnpaidRemindersForRoom,
  listUnpaidFinalReminderClaimTimes,
  memoryUnpaidReminderClaims,
  unpaidRaceExpiresAtMs
} from "../lib/unpaidRaceReminderScheduler.js";
import { isTeaserRoom, projectionForRoom, roomForViewer, scheduleCourseLengthOf, teaserProjection } from "../lib/raceTeaser.js";
import { isManualBillingAllowed } from "../lib/billingEnv.js";
import {
  isRaceLocked,
  aidStationLockAt,
  raceStartChangeAllowed,
  RACE_LOCKED_CODE,
  RACE_LOCKED_ERROR,
  RaceLockedError
} from "../lib/raceLock.js";

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

/**
 * Longest planned stop a checkpoint may carry (6 h). Covers sleep stops on 200-mile races while
 * still rejecting obvious unit mistakes (seconds typed as minutes × 60 twice).
 */
export const MAX_PLANNED_STOP_SECONDS = 6 * 3600;

/**
 * #250 Pace edit: per-checkpoint planned stop. Set semantics (each row is the new absolute value),
 * so a retried request is naturally idempotent.
 */
const patchCheckpointStopsInput = z
  .object({
    stops: z
      .array(
        z.object({
          checkpointId: z.string().min(1),
          plannedStopSeconds: z.number().int().min(0).max(MAX_PLANNED_STOP_SECONDS)
        })
      )
      .min(1)
      .max(500)
  })
  .refine((value) => new Set(value.stops.map((stop) => stop.checkpointId)).size === value.stops.length, {
    message: "Each checkpoint may appear once"
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
  points: z.array(raceCourseBaselinePointInput).min(2),
  planLogSigma: z.number().finite().positive().max(2).optional(),
  planProfileBranch: z.enum(["coldStart", "coarseHistory", "similarHistory"]).optional()
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
  /** Raw course GPX XML for reprocess / audit. */
  courseGpxXml: z.string().min(1).optional(),
  routeOverlayLayer: mapWorkspaceLayerInput.optional(),
  /** Required: official race clock anchor for projection / Pace (ISO datetime). */
  raceStartAt: z.iso.datetime()
});

/** `PATCH /race-rooms/:roomId/race-start`: the start alone, validated as `PUT /course` takes it. */
const updateRaceStartInput = z.object({
  raceStartAt: z.iso.datetime()
});

/** `PATCH /race-rooms/:roomId`: rename the race. */
const renameRaceRoomInput = z.object({
  name: z.string().trim().min(1).max(80)
});

const putRaceMapWorkspaceInput = z.object({
  layers: z.array(mapWorkspaceLayerInput).max(24),
  selectedLayerId: z.string().optional(),
  drivesProjectionLayerId: z.string().optional(),
  checkpoints: z.array(raceCourseCheckpointInput),
  syncBaselineFromLayer: z.boolean().optional()
});

const updateEntitlementInput = z.object({
  status: z.enum(["unpaid", "paid", "expired"]),
  /** Defaults to unlimited so a hand-paid dev or staging room keeps today's behavior. */
  crewTier: z.enum(["one", "unlimited"]).optional()
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

const MAX_PING_BATCH_POINTS = 500;

const ingestAthletePingBatchInput = z.object({
  points: z
    .array(
      z.object({
        latitude: z.number().gte(-90).lte(90),
        longitude: z.number().gte(-180).lte(180),
        recordedAt: z.iso.datetime(),
        horizontalAccuracyMeters: z.number().positive().optional()
      })
    )
    .min(1)
    .max(MAX_PING_BATCH_POINTS),
  uploadIntervalSeconds: z.number().int().min(10).max(900).optional()
});

const pingTrackQuery = z.object({
  after: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(1000)
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

/** Drop overlays whose checkpoint was removed so GET room and Postgres JSON stay aligned with GET /stop-plans. */
function pruneStopPlansToLiveCheckpoints(room: RaceRoom): RaceRoom {
  if (!room.stopPlans?.length) {
    return room;
  }
  const knownIds = new Set((room.course?.checkpoints ?? []).map((checkpoint) => checkpoint.id));
  const stopPlans = room.stopPlans.filter((plan) => knownIds.has(plan.checkpointId));
  if (stopPlans.length === room.stopPlans.length) {
    return room;
  }
  if (stopPlans.length === 0) {
    const next = { ...room };
    delete next.stopPlans;
    return next;
  }
  return { ...room, stopPlans };
}

const roomSaveTail = new Map<string, Promise<void>>();
const inviteSaveTail = new Map<string, Promise<void>>();
/** One `POST /race-rooms` at a time per creator, so two at once can't both take the last unpaid slot. */
const roomCreateTail = new Map<string, Promise<void>>();

let roomCreateDelayForTests: (() => Promise<void>) | undefined;

/** Test-only one-shot pause in `POST /race-rooms` after the unpaid race count and before the save. */
export function setRaceRoomCreateDelayForTests(delay: (() => Promise<void>) | undefined): void {
  roomCreateDelayForTests = delay;
}

let roomSaveTailWaitForTests: ((key: string) => void) | undefined;

/** Test-only signal when a room or invite persist has to wait for an in-flight write. */
export function setRoomSaveTailWaitForTests(listener: ((key: string) => void) | undefined): void {
  roomSaveTailWaitForTests = listener;
}

async function withExclusiveTail<T>(
  tails: Map<string, Promise<void>>,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const contended = tails.has(key);
  tails.set(key, current);
  if (contended) {
    roomSaveTailWaitForTests?.(key);
  }
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === current) {
      tails.delete(key);
    }
  }
}

export async function saveRaceRoom(room: RaceRoom): Promise<void> {
  const persisted = pruneStopPlansToLiveCheckpoints(room);
  // One persist at a time per room. Overlapping full-document writes let the slower
  // UPDATE land last and drop a membership the faster write had already committed.
  // A failed write's rollback must also restore the last settled room, not another
  // in-flight snapshot that never reached the database.
  await withExclusiveTail(roomSaveTail, persisted.id, async () => {
    const previous = raceRooms.get(persisted.id);
    unindexJoinCodeForRoomId(persisted.id);
    raceRooms.set(persisted.id, persisted);
    indexJoinCode(persisted);
    try {
      await persistRaceRoom(persisted);
    } catch (err) {
      // A failed write must not keep serving the new room (a join-by-code membership, say):
      // retries would get 200 and a restart would drop it. Leave a newer write alone.
      if (raceRooms.get(persisted.id) === persisted) {
        unindexJoinCodeForRoomId(persisted.id);
        if (previous) {
          raceRooms.set(previous.id, previous);
          indexJoinCode(previous);
        } else {
          raceRooms.delete(persisted.id);
        }
      }
      throw err;
    }
  });
}

/**
 * Hydrate the live room cache from a DB row without rolling back a newer in-process write.
 *
 * GET `/race-rooms/mine`, team listing, and `getRaceRoom` cache-miss loads previously
 * `raceRooms.set` every persisted row. A SELECT that started before `saveRaceRoom`
 * committed could resume after the write and replace memory with that stale snapshot.
 * The next read-modify-write (stop-plan, join, course, estimate attach, …) then
 * persisted the rollback.
 *
 * After deploy the cache is empty, so the first GET of a room (schedule, course, …)
 * overlaps in-flight writes the same way listing did.
 */
/**
 * Room deletes so far in this process, and the count at which each deleted room went. A cold read
 * (`getRaceRoom` cache miss, a room listing) notes the count before its SELECT and caches only
 * rooms not deleted since: a row it read before the delete committed must not put the room back
 * in the cache, where the next save would upsert it back into Postgres. A room created again
 * under the same id (an idempotent create replayed) is read after the delete and is cached.
 */
let roomDeleteCount = 0;
const roomDeletedAtCount = new Map<string, number>();

function deletedSince(roomId: string, readStartedAt: number): boolean {
  return (roomDeletedAtCount.get(roomId) ?? -1) >= readStartedAt;
}

function rememberRaceRoomIfAbsent(room: RaceRoom): RaceRoom {
  const live = raceRooms.get(room.id);
  if (live) {
    return live;
  }
  raceRooms.set(room.id, room);
  indexJoinCode(room);
  return room;
}

/**
 * Hydrate the live room cache from a DB list without rolling back a newer in-process write.
 */
function ingestPersistedRaceRoomsWithoutClobber(rooms: readonly RaceRoom[], readStartedAt = roomDeleteCount): RaceRoom[] {
  const kept = rooms.filter((room) => !deletedSince(room.id, readStartedAt));
  for (const room of kept) {
    rememberRaceRoomIfAbsent(room);
    indexJoinCode(room);
  }
  return kept;
}

/** Test helper: simulate a late list payload against the live room cache. */
export function ingestPersistedRaceRoomsWithoutClobberForTests(rooms: readonly RaceRoom[]): void {
  ingestPersistedRaceRoomsWithoutClobber(rooms);
}

/** Test helper: simulate a late `getRaceRoom` SELECT completing against the live cache. */
export function ingestPersistedRaceRoomWithoutClobberForTests(room: RaceRoom): RaceRoom {
  return rememberRaceRoomIfAbsent(room);
}

function rememberRaceRoomInviteIfAbsent(invite: RaceRoomInvite): RaceRoomInvite {
  const live = raceRoomInvites.get(invite.token);
  if (live) {
    return live;
  }
  raceRoomInvites.set(invite.token, invite);
  return invite;
}

/** Test-only: drop cached invites, as a fresh API process starts with none. */
export function evictRaceRoomInvitesFromMemoryForTests(): void {
  raceRoomInvites.clear();
}

/** Test-only: drop one cached room, as a fresh API process starts without it. */
export function evictRaceRoomFromMemoryForTests(roomId: string): void {
  raceRooms.delete(roomId);
}

/** Test helper: simulate a late invite SELECT completing against the live cache. */
export function ingestPersistedRaceRoomInviteWithoutClobberForTests(invite: RaceRoomInvite): RaceRoomInvite {
  return rememberRaceRoomInviteIfAbsent(invite);
}

function mergeListedRaceRooms(
  persisted: readonly RaceRoom[],
  include: (room: RaceRoom) => boolean
): RaceRoom[] {
  const merged = new Map<string, RaceRoom>();
  for (const room of persisted) {
    merged.set(room.id, room);
  }
  for (const room of raceRooms.values()) {
    if (include(room)) {
      merged.set(room.id, room);
    }
  }
  return [...merged.values()];
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
  await withExclusiveTail(inviteSaveTail, invite.token, async () => {
    const previous = raceRoomInvites.get(invite.token);
    raceRoomInvites.set(invite.token, invite);
    try {
      await persistRaceRoomInvite(invite);
    } catch (err) {
      // Same rollback as saveRaceRoom, so a failed persist can't leave a ghost invite.
      // Serialized so the restored invite is the last settled one, not another failed write.
      if (raceRoomInvites.get(invite.token) === invite) {
        if (previous) {
          raceRoomInvites.set(invite.token, previous);
        } else {
          raceRoomInvites.delete(invite.token);
        }
      }
      throw err;
    }
  });
}

let roomLoadDelayForTests: (() => Promise<void>) | undefined;

/**
 * Test-only one-shot pause in a `getRaceRoom` cache miss, after the stored row is read and before
 * it is cached: a cold read that overlaps another request.
 */
export function setRaceRoomLoadDelayForTests(delay: (() => Promise<void>) | undefined): void {
  roomLoadDelayForTests = delay;
}

export async function getRaceRoom(roomIdOrCode: string): Promise<RaceRoom | undefined> {
  const resolvedId = await resolveStorageRoomId(roomIdOrCode);
  if (!resolvedId) {
    return undefined;
  }
  let room = raceRooms.get(resolvedId);
  if (!room) {
    const readStartedAt = roomDeleteCount;
    const loaded = await loadRaceRoom(resolvedId);
    const delay = roomLoadDelayForTests;
    if (loaded && delay) {
      roomLoadDelayForTests = undefined;
      await delay();
    }
    if (loaded && !deletedSince(resolvedId, readStartedAt)) {
      // Re-check live cache after the await — a concurrent saveRaceRoom may have won.
      room = rememberRaceRoomIfAbsent(loaded);
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
  if (!loaded) {
    return undefined;
  }
  return rememberRaceRoomInviteIfAbsent(loaded);
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
    // Anonymous, and the plan curve prices every checkpoint: an unpaid race never sends it.
    ...(isTeaserRoom(room) ? {} : { baselineTrack: room.course?.baselineTrack }),
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
  liveRatio?: LiveRatioAccumulator;
  lastProjectionCore: RaceRoomProjectionCore;
};

const roomProjectionState = new Map<string, RoomProjectionState>();

const ws2RuntimeHydrator = createLazyHydrator();

let ws2LoadDelayForTests: (() => Promise<void>) | undefined;

/** Test-only one-shot pause at the start of a WS2 runtime load. */
export function setWs2LoadDelayForTests(delay: (() => Promise<void>) | undefined): void {
  ws2LoadDelayForTests = delay;
}

/**
 * Per-room queue for ping projection commits, manual check-ins, and membership writes.
 * A ping copies projection state, awaits history persistence, then replaces the
 * in-memory projection. A check-in that mutates the previous object in that gap
 * returns 200 while the ping's replace drops the visit. Join-by-code and invite
 * accept read the member list and write it back whole, so two at once drop one member.
 */
const roomRuntimeTail = new Map<string, Promise<void>>();

let pingProjectionCommitDelayForTests: { roomId: string; delay: () => Promise<void> } | undefined;
let roomRuntimeLockWaitForTests: ((roomId: string) => void) | undefined;

/** Test-only pause after a ping has copied projection state and before it commits the replace. */
export function setPingProjectionCommitDelayForTests(
  roomId: string,
  delay: (() => Promise<void>) | undefined
): void {
  pingProjectionCommitDelayForTests =
    delay === undefined ? undefined : { roomId, delay };
}

let pingBeforeLockDelayForTests: { roomId: string; delay: () => Promise<void> } | undefined;

/** Test-only one-shot pause after a ping or batch upload has read the room and before it takes the room runtime lock. */
export function setPingBeforeLockDelayForTests(
  roomId: string,
  delay: (() => Promise<void>) | undefined
): void {
  pingBeforeLockDelayForTests = delay === undefined ? undefined : { roomId, delay };
}

let membershipWriteDelayForTests: (() => Promise<void>) | undefined;

/** Test-only one-shot pause after join-by-code reads the member list and before it saves. */
export function setMembershipWriteDelayForTests(delay: (() => Promise<void>) | undefined): void {
  membershipWriteDelayForTests = delay;
}

/** Test-only signal when a caller has to wait for another runtime write on the same room. */
export function setRoomRuntimeLockWaitForTests(listener: ((roomId: string) => void) | undefined): void {
  roomRuntimeLockWaitForTests = listener;
}

async function withRoomRuntimeLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const previous = roomRuntimeTail.get(roomId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const contended = roomRuntimeTail.has(roomId);
  roomRuntimeTail.set(roomId, current);
  if (contended) {
    roomRuntimeLockWaitForTests?.(roomId);
  }
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (roomRuntimeTail.get(roomId) === current) {
      roomRuntimeTail.delete(roomId);
    }
  }
}

/**
 * Re-read the room under the runtime lock and persist `edit(latest)`.
 * A full-document save that snapshotted before an in-flight persist, then
 * queued behind the writer that adds a member, commits the roster from before
 * that join. The joiner already received 200 and then vanishes. Course,
 * checkpoint, stop-plan, map, entitlement, and member handlers all go through
 * here so they serialize with join and invite accept.
 */
export async function commitRaceRoomUpdate(
  roomId: string,
  edit: (latest: RaceRoom) => RaceRoom
): Promise<RaceRoom | undefined> {
  return commitRaceRoomUpdateAsync(roomId, async (latest) => edit(latest));
}

/** {@link commitRaceRoomUpdate} for an edit that has to read storage under the room lock (billing grants). */
export async function commitRaceRoomUpdateAsync(
  roomId: string,
  edit: (latest: RaceRoom) => Promise<RaceRoom>
): Promise<RaceRoom | undefined> {
  return withRoomRuntimeLock(roomId, async () => {
    const latest = await getRaceRoom(roomId);
    if (!latest) {
      return undefined;
    }
    const next = await edit(latest);
    await saveRaceRoom(next);
    return next;
  });
}

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

function isLiveRatioPayload(x: unknown): x is LiveRatioAccumulator {
  if (!x || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  return ["actualSeconds", "plannedSeconds", "progressMeters", "asOfMs"].every(
    (key) => typeof o[key] === "number" && Number.isFinite(o[key])
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
        ...(isLiveRatioPayload(pr.liveRatio) ? { liveRatio: pr.liveRatio } : {}),
        lastProjectionCore: pr.lastProjectionCore as RaceRoomProjectionCore
      };
    }
  }
  return { ping, projection };
}

async function loadWs2RuntimeIfNeeded(roomId: string): Promise<void> {
  const delay = ws2LoadDelayForTests;
  if (delay) {
    ws2LoadDelayForTests = undefined;
    await delay();
  }
  if (!isRoomPersistenceEnabled()) {
    return;
  }
  await ws2RuntimeHydrator.loadIfNeeded(roomId, async ({ stillCurrent }) => {
    const raw = await loadWs2RuntimePayload(roomId);
    if (!stillCurrent()) {
      return;
    }
    const { ping, projection } = normalizeWs2RuntimePayload(raw);
    if (!stillCurrent()) {
      return;
    }
    if (ping) {
      roomPingState.set(roomId, ping);
    }
    if (projection) {
      roomProjectionState.set(roomId, projection);
    }
  });
}

/** Drop live ping/projection and the durable copy together so a concurrent hydrate cannot restore either. */
async function discardWs2Runtime(roomId: string): Promise<void> {
  await ws2RuntimeHydrator.reset(roomId, async () => {
    roomPingState.delete(roomId);
    roomProjectionState.delete(roomId);
    await deleteWs2RuntimePayload(roomId);
    await deleteTrack(roomId);
    roomPingState.delete(roomId);
    roomProjectionState.delete(roomId);
  });
}

let ws2SnapshotSaveFailureForTests: Error | undefined;

/** Test-only: the next WS2 runtime snapshot save throws `error` (memory mode included). */
export function setWs2SnapshotSaveFailureForTests(error: Error | undefined): void {
  ws2SnapshotSaveFailureForTests = error;
}

async function saveWs2RuntimeSnapshot(roomId: string): Promise<void> {
  const failure = ws2SnapshotSaveFailureForTests;
  if (failure) {
    ws2SnapshotSaveFailureForTests = undefined;
    throw failure;
  }
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
 * `estimate` with its clocks (finish, bands, aid ETAs) at `raceStartAt` plus their elapsed
 * seconds, as the estimator writes them: the plan of record once the start moved. The elapsed
 * plan stays as computed. Unchanged when `raceStartAt` does not parse.
 */
export function estimateAtStart(estimate: PacingEstimate, raceStartAt: string): PacingEstimate {
  const startMs = Date.parse(raceStartAt);
  if (Number.isNaN(startMs)) {
    return estimate;
  }
  const clockAt = (elapsedSeconds: number) => new Date(startMs + elapsedSeconds * 1000).toISOString();
  const shifted: PacingEstimate = {
    ...estimate,
    expectedFinishAt: clockAt(estimate.expectedFinishElapsedSeconds),
    aidEtas: estimate.aidEtas.map((eta) => ({ ...eta, clockArrivalAt: clockAt(eta.elapsedSeconds) }))
  };
  if (estimate.bands) {
    const bands: NonNullable<PacingEstimate["bands"]> = {};
    for (const [kind, point] of Object.entries(estimate.bands) as Array<
      [keyof NonNullable<PacingEstimate["bands"]>, NonNullable<PacingEstimate["bands"]>[keyof NonNullable<PacingEstimate["bands"]>]]
    >) {
      if (point) {
        bands[kind] = { ...point, finishAt: clockAt(point.finishElapsedSeconds) };
      }
    }
    shifted.bands = bands;
  }
  return shifted;
}

/** `room` with `raceStartAt` and `activatedAt` at `raceStartAt`, and the plan of record's clocks with them. */
function withRaceStart(room: RaceRoom, raceStartAt: string): RaceRoom {
  return {
    ...room,
    raceStartAt,
    activatedAt: raceStartAt,
    ...(room.pacingEstimate ? { pacingEstimate: estimateAtStart(room.pacingEstimate, raceStartAt) } : {})
  };
}

/**
 * The race start (ms) pings are judged against: `raceStartAt`, when the room has one. A ping
 * recorded before it is a pre-start (test) ping: the runner's "test tracking now" days before the
 * race, or a ping sent on race morning before the gun. It is stored, and the latest one still
 * shows the runner's dot (`pings/latest`), but it never drives the projection, its ETAs, the
 * schedule's closed visits or the projection's freshness. The elapsed-time anchor stays
 * `resolveRaceAnchorIso`.
 */
function raceStartMs(room: RaceRoom): number | undefined {
  const iso = room.raceStartAt?.trim();
  if (!iso) {
    return undefined;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Whether a ping recorded at `recordedAtMs` is before the race start (see `raceStartMs`). */
function isPreStartPing(room: RaceRoom, recordedAtMs: number): boolean {
  const startMs = raceStartMs(room);
  return startMs !== undefined && recordedAtMs < startMs;
}

/**
 * The last accepted ping that counts for the race: null when there is none or it is pre-start.
 * Pings are accepted in `recordedAt` order, so a pre-start last ping means every accepted ping
 * is pre-start and the race has no ping yet.
 */
function lastRacePing(pingState: RoomPingState, room: RaceRoom): AcceptedPing | null {
  const last = pingState.lastAccepted;
  return last && !isPreStartPing(room, last.recordedAtMs) ? last : null;
}

/** `asOfPingId` of the pre-race projection (`ensureBootstrapProjection`): no ping drove it. */
const BOOTSTRAP_PING_ID = "bootstrap";

/**
 * When course + pace + anchor exist but no projection state yet (no accepted race ping),
 * seed in-memory (and persisted) projection at the course start. Taken before the start, its
 * finish is the start plus the plan, not now plus the plan (`recomputeRaceProjection` counts the
 * rest of the course from the later of the two).
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
  const pingId = BOOTSTRAP_PING_ID;
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
    const enrichedCore = enrichProjectionWithLiveRemaining(
      nextProjectionCore,
      room,
      routeMetricPoints,
      anchor
    );
    roomProjectionState.set(roomId, {
      lastProgressMeters: state.lastProgressMeters,
      splitCrossedAt: { ...state.splitCrossedAt },
      visitStates: structuredClone(state.visitStates),
      visitMeta: structuredClone(state.visitMeta),
      rollingMovingSpeedMps: state.rollingMovingSpeedMps,
      ...(state.liveRatio ? { liveRatio: { ...state.liveRatio } } : {}),
      lastProjectionCore: enrichedCore
    });
    if (persistSnapshot) {
      await saveWs2RuntimeSnapshot(roomId);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * After attaching a pacing estimate (new baselineTrack + plannedPaceSecondsPerKm), refresh the
 * stored projection so Pace / map clocks match the schedule. Schedule rebuilds from the estimate
 * on every GET; Pace reads `checkpointSplits.plannedElapsedSecondsAtCross` from the stored
 * projection — without this refresh those splits stay on the pre-attach plan (#487 Pace lag).
 *
 * Pre-race (no accepted race ping; pre-start pings do not count): re-seed from the new plan at
 * the room's start, keeping the crew's check-ins so Recalculate cannot erase check-ins that
 * landed before the first GPS ping (`reseedPreRaceProjection`).
 * In-race (race ping present): recompute over the last accepted ping with the new baseline/pace
 * (visit state is already carried via `previous`).
 * The start-time route (`PATCH /race-start`) refreshes through here too, so a pre-race projection
 * is re-seeded at the new start.
 */
export async function refreshProjectionAfterPlanOfRecordChange(
  roomId: string,
  room: RaceRoom,
  log?: { warn: (obj: object, msg?: string) => void }
): Promise<void> {
  await loadWs2RuntimeIfNeeded(roomId);
  await recomputeProjectionForRoomChange(roomId, room, (err) =>
    log?.warn({ err, roomId }, "projection_recompute_after_estimate_attach_failed")
  );
}

/**
 * Recompute the stored projection after the room changed (course, plan, start), then save it.
 * With a race ping, over the last one (`recomputeStoredProjectionAfterCourseChange`). Without
 * one (pre-start pings do not count), re-seeded at the room's start with only the crew's
 * check-ins kept (`reseedPreRaceProjection`): nothing a pre-start ping put there survives. A
 * recompute that fails is passed to `onRecomputeError` and the stored projection stays.
 *
 * `previousAnchorIso` is the race clock start before the change. When the start moved (PATCH
 * /race-start, or a course save with another start), the start crossing moves with it before the
 * recompute (`reanchorStartCrossing`), whichever route moved it.
 */
async function recomputeProjectionForRoomChange(
  roomId: string,
  room: RaceRoom,
  onRecomputeError: (err: unknown) => void,
  previousAnchorIso?: string
): Promise<void> {
  const pingState = getOrInitPingState(roomId);
  if (lastRacePing(pingState, room)) {
    reanchorStartCrossing(roomId, room, previousAnchorIso);
    try {
      await recomputeStoredProjectionAfterCourseChange(roomId, room);
    } catch (err) {
      onRecomputeError(err);
    }
    // A room whose route went away loses its projection there; seed one if it can.
    await ensureBootstrapProjection(roomId, room, false);
  } else {
    await reseedPreRaceProjection(roomId, room);
    // The staleness threshold is a race ping's to set: one the start move made pre-start no longer
    // sets it.
    delete pingState.lastUploadIntervalSeconds;
  }
  await saveWs2RuntimeSnapshot(roomId);
}

/**
 * The start moved from `previousAnchorIso` to the room's race clock start: a start crossing at the
 * old start (the first projection puts it there, `recomputeRaceProjection`) moves to the new one,
 * so the elapsed time and the finish anchored at it move with the start. A crossing anywhere else
 * stays. Changes the stored projection in place; the recompute that follows carries it.
 */
function reanchorStartCrossing(roomId: string, room: RaceRoom, previousAnchorIso: string | undefined): void {
  const anchor = resolveRaceAnchorIso(room);
  const startId = room.course?.checkpoints[0]?.id;
  const stored = roomProjectionState.get(roomId);
  if (!stored || startId === undefined || !anchor || previousAnchorIso === undefined) {
    return;
  }
  const crossed = stored.splitCrossedAt[startId];
  if (crossed !== undefined && Date.parse(crossed) === Date.parse(previousAnchorIso)) {
    stored.splitCrossedAt = { ...stored.splitCrossedAt, [startId]: anchor };
  }
}

/**
 * Before the race's first ping (pre-start pings do not count): drop the stored projection, seed
 * the bootstrap at the room's start, and put the crew's check-ins back on it
 * (`crewCheckInSplits`). The position, crossings, stops and auto visits pings put there are not
 * kept: every one came from a ping that is pre-start now (the start moved later than it), or
 * from before pre-start pings were ignored. Not persisted; the caller saves.
 *
 * `keepOnFailure`: when no bootstrap can be seeded (no route, plan or start), the stored
 * projection is put back as it was, check-ins and all, and false is returned. Without it the
 * room is left with no projection (a start change: what was stored no longer applies).
 */
async function reseedPreRaceProjection(
  roomId: string,
  room: RaceRoom,
  options: { keepOnFailure?: boolean } = {}
): Promise<boolean> {
  const previous = roomProjectionState.get(roomId);
  const checkIns = previous ? crewCheckInSplits(previous.lastProjectionCore.checkpointSplits) : [];
  roomProjectionState.delete(roomId);
  const seeded = await ensureBootstrapProjection(roomId, room, false);
  if (!seeded) {
    if (options.keepOnFailure && previous) {
      roomProjectionState.set(roomId, previous);
    }
    return false;
  }
  if (checkIns.length > 0) {
    restoreProjectionVisitLogs(roomId, checkIns, room);
  }
  return true;
}

/**
 * Whether the stored projection was driven by pings that are pre-start: a ping drove it (it is not
 * the bootstrap), and the room's latest accepted ping is before the race start, so every accepted
 * ping is. A server from before pre-start pings were ignored folded a runner's test pings into the
 * projection and stored it; nothing since has replaced it while the race has no race ping.
 */
function hasStalePreStartProjection(roomId: string, room: RaceRoom): boolean {
  // A finished race (completed) or an expired one is history: its reads are left as stored.
  if (room.status === "completed" || room.entitlement.status === "expired") {
    return false;
  }
  const stored = roomProjectionState.get(roomId);
  const last = roomPingState.get(roomId)?.lastAccepted;
  return Boolean(
    stored && stored.lastProjectionCore.asOfPingId !== BOOTSTRAP_PING_ID && last && isPreStartPing(room, last.recordedAtMs)
  );
}

/**
 * A read of the projection re-seeds a stale pre-start one (`hasStalePreStartProjection`) and saves
 * it, so a race created before pre-start pings were ignored reads what a race created since reads:
 * the projection at the start, with only the crew's check-ins kept (`reseedPreRaceProjection`),
 * and no upload interval adopted from a test ping. Takes the room runtime lock only when there is
 * something to re-seed, and checks again under it; callers must not hold it. When no bootstrap can
 * be seeded the stored projection stays as it was. A failed save is logged and the read is served
 * the re-seeded view (the next read re-seeds again from the stored copy).
 */
async function reseedStalePreStartProjectionOnRead(roomId: string, room: RaceRoom, log?: WarnLog): Promise<void> {
  if (!hasStalePreStartProjection(roomId, room)) {
    return;
  }
  await withRoomRuntimeLock(roomId, async () => {
    await loadWs2RuntimeIfNeeded(roomId);
    const latest = await getRaceRoom(roomId);
    if (!latest || !hasStalePreStartProjection(roomId, latest)) {
      return;
    }
    if (!(await reseedPreRaceProjection(roomId, latest, { keepOnFailure: true }))) {
      return;
    }
    delete getOrInitPingState(roomId).lastUploadIntervalSeconds;
    try {
      await saveWs2RuntimeSnapshot(roomId);
    } catch (err) {
      log?.warn({ err, roomId }, "stale_pre_start_projection_reseed_save_failed");
    }
  });
}

type WarnLog = { warn: (obj: object, msg?: string) => void };

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
/** Bumped when local board state is cleared so an in-flight hydrate cannot republish a wiped board. */
const taskBoardHydrateEpoch = new Map<string, number>();
/** One cold load per room. A second cache-miss must not apply an older snapshot over a write. */
const taskBoardHydrateInflight = new Map<string, Promise<RoomTaskBoardState>>();

/**
 * Test-only pause at the start of a cold hydrate, before the board is published.
 * The in-flight slot is registered before the caller yields, so a second cache-miss
 * waits on the same load instead of publishing a second board.
 */
let taskBoardHydrateDelayForTests: (() => Promise<void>) | undefined;

export function setTaskBoardHydrateDelayForTests(delay: (() => Promise<void>) | undefined): void {
  taskBoardHydrateDelayForTests = delay;
}

const TASK_TIMELINE_CAP = 100;

const MAX_CLOCK_SKEW_MS = 120_000;
const MAX_SPEED_MPS = 15;
const MAX_HORIZONTAL_ACCURACY_M = 500;
const PING_HISTORY_CAP = 50;
/** A backlog never reaches further back than this, whatever the race clock says. */
const MAX_PING_BACKLOG_MS = 48 * 60 * 60 * 1000;
/** Samples this long before the race clock starts are warm-up, not race (e.g. the walk to the start). */
const PRE_RACE_BACKLOG_GRACE_MS = 60 * 60 * 1000;

/**
 * Oldest `recordedAt` (ms) a backlog upload may carry. Older samples are rejected as `clock_skew`.
 * `raceAnchorMs` is the room's race clock start (`raceStartAt`, else `activatedAt`), when known.
 */
export function backlogFloorMs(nowMs: number, raceAnchorMs: number | undefined): number {
  const hardFloor = nowMs - MAX_PING_BACKLOG_MS;
  // Before the start (or with no race clock) accept warm-up samples, as the single ping does.
  if (raceAnchorMs === undefined || raceAnchorMs > nowMs) {
    return hardFloor;
  }
  return Math.max(hardFloor, raceAnchorMs - PRE_RACE_BACKLOG_GRACE_MS);
}

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
  // A course wipe holds this gate until both durable rows are gone. Waiting
  // here is what stops a poll from hydrating the snapshot mid-delete.
  for (;;) {
    const gate = taskBoardResetGate.get(room.id);
    if (!gate) {
      break;
    }
    await gate.promise;
  }

  const cached = roomTaskBoardState.get(room.id);
  if (cached) {
    return cached;
  }

  const inflight = taskBoardHydrateInflight.get(room.id);
  if (inflight) {
    try {
      return await inflight;
    } catch (err) {
      const live = roomTaskBoardState.get(room.id);
      if (live) {
        return live;
      }
      throw err;
    }
  }

  const epoch = taskBoardHydrateEpoch.get(room.id) ?? 0;
  const load = loadTaskBoardIntoCache(room, epoch);
  taskBoardHydrateInflight.set(room.id, load);
  try {
    return await load;
  } finally {
    if (taskBoardHydrateInflight.get(room.id) === load) {
      taskBoardHydrateInflight.delete(room.id);
    }
  }
}

async function loadTaskBoardIntoCache(room: RaceRoom, epoch: number): Promise<RoomTaskBoardState> {
  if (taskBoardHydrateDelayForTests) {
    await taskBoardHydrateDelayForTests();
  }

  const abandoned = (): RoomTaskBoardState | undefined => {
    if (!taskBoardHydrateWasReset(room.id, epoch)) {
      return undefined;
    }
    return roomTaskBoardState.get(room.id);
  };

  const snapshot = await loadTaskBoardSnapshot(room.id);
  const abandonedAfterSnapshot = abandoned();
  if (abandonedAfterSnapshot) {
    return abandonedAfterSnapshot;
  }
  if (taskBoardHydrateWasReset(room.id, epoch)) {
    throw taskBoardResetDuringLoadError();
  }
  if (snapshot) {
    const parsedSnapshot = normalizeTaskBoardPayload({
      version: snapshot.version,
      board: snapshot.payload
    });
    if (parsedSnapshot) {
      const persistedVersion = await loadTaskBoardPayloadVersion(room.id);
      const abandonedAfterVersion = abandoned();
      if (abandonedAfterVersion) {
        return abandonedAfterVersion;
      }
      if (taskBoardHydrateWasReset(room.id, epoch)) {
        throw taskBoardResetDuringLoadError();
      }
      if (persistedVersion === undefined || persistedVersion <= parsedSnapshot.version) {
        return rememberTaskBoardIfAbsent(room.id, parsedSnapshot);
      }
    }
  }

  const raw = await loadTaskBoardPayload(room.id);
  const abandonedAfterPayload = abandoned();
  if (abandonedAfterPayload) {
    return abandonedAfterPayload;
  }
  if (taskBoardHydrateWasReset(room.id, epoch)) {
    throw taskBoardResetDuringLoadError();
  }
  const parsed = normalizeTaskBoardPayload(raw);
  if (parsed) {
    const published = rememberTaskBoardIfAbsent(room.id, parsed);
    if (published === parsed) {
      await refreshTaskBoardSnapshot(room.id, parsed);
    }
    return roomTaskBoardState.get(room.id) ?? published;
  }

  const built = buildInitialTaskBoard(room);
  const published = rememberTaskBoardIfAbsent(room.id, built);
  if (published !== built) {
    return published;
  }
  if (taskBoardHydrateWasReset(room.id, epoch)) {
    if (roomTaskBoardState.get(room.id) === built) {
      roomTaskBoardState.delete(room.id);
    }
    const live = roomTaskBoardState.get(room.id);
    if (live) {
      return live;
    }
    throw taskBoardResetDuringLoadError();
  }
  await saveTaskBoard(room.id, built);
  return roomTaskBoardState.get(room.id) ?? built;
}

async function saveTaskBoard(roomId: string, board: RoomTaskBoardState): Promise<void> {
  await enqueueTaskBoardWrite(roomId, async () => {
    // The handler mutated `board` before this ran. A course wipe that cleared
    // the cache in between must not let this persist put that board back.
    if (taskBoardResetGate.has(roomId) || roomTaskBoardState.get(roomId) !== board) {
      throw taskBoardResetDuringLoadError();
    }
    roomTaskBoardState.set(roomId, board);
    await persistTaskBoardPayload(
      roomId,
      {
        version: board.version,
        board: toTaskBoardPayload(board)
      } satisfies PersistedTaskBoardRecord
    );
    if (taskBoardResetGate.has(roomId) || roomTaskBoardState.get(roomId) !== board) {
      if (roomTaskBoardState.get(roomId) === board) {
        roomTaskBoardState.delete(roomId);
      }
      throw taskBoardResetDuringLoadError();
    }
    await refreshTaskBoardSnapshot(roomId, board);
  });
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
  taskBoardHydrateInflight.delete(roomId);
  taskBoardHydrateEpoch.set(roomId, (taskBoardHydrateEpoch.get(roomId) ?? 0) + 1);
}

type TaskBoardResetGate = {
  promise: Promise<void>;
  release: () => void;
};

/** Held from the moment a course wipe drops the cache until both durable rows are gone. */
const taskBoardResetGate = new Map<string, TaskBoardResetGate>();

const taskBoardWriteTail = new Map<string, Promise<void>>();

let taskBoardDiscardDelayForTests: (() => Promise<void>) | undefined;

/** Test-only one-shot pause after a course wipe drops the cache and before it deletes durable rows. */
export function setTaskBoardDiscardDelayForTests(delay: (() => Promise<void>) | undefined): void {
  taskBoardDiscardDelayForTests = delay;
}

function enqueueTaskBoardWrite<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const previous = taskBoardWriteTail.get(roomId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  taskBoardWriteTail.set(roomId, settled);
  void settled.then(() => {
    if (taskBoardWriteTail.get(roomId) === settled) {
      taskBoardWriteTail.delete(roomId);
    }
  });
  return run;
}

function beginTaskBoardResetGate(roomId: string): TaskBoardResetGate {
  let release: () => void = () => {};
  const gate: TaskBoardResetGate = {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release()
  };
  taskBoardResetGate.set(roomId, gate);
  return gate;
}

function endTaskBoardResetGate(roomId: string, gate: TaskBoardResetGate): void {
  if (taskBoardResetGate.get(roomId) === gate) {
    taskBoardResetGate.delete(roomId);
  }
  gate.release();
}

/**
 * Drop the live task board and both durable copies as one operation.
 * `clear` then `await delete` left a gap: payload was already gone, so a
 * concurrent GET treated the surviving snapshot as authoritative and cached
 * the pre-wipe board. The next assignment or protocol note wrote it back.
 */
async function discardTaskBoardState(roomId: string): Promise<void> {
  await enqueueTaskBoardWrite(roomId, async () => {
    const gate = beginTaskBoardResetGate(roomId);
    try {
      clearTaskBoardLocalState(roomId);
      const delay = taskBoardDiscardDelayForTests;
      if (delay) {
        taskBoardDiscardDelayForTests = undefined;
        await delay();
      }
      await deleteTaskBoardPayload(roomId);
      await deleteTaskBoardSnapshot(roomId);
    } finally {
      clearTaskBoardLocalState(roomId);
      endTaskBoardResetGate(roomId, gate);
    }
  });
}

/**
 * A course reset landed while this cold load was reading persistence. Not retried here:
 * the caller's `room` predates the reset, so a rebuild would use the old course.
 * Fastify maps `statusCode` to a 409 the client can retry.
 */
function taskBoardResetDuringLoadError(): Error & { statusCode: number; code: string } {
  return Object.assign(new Error("task_board_reset_during_load"), {
    statusCode: 409,
    code: "task_board_reset_during_load"
  });
}

/**
 * Install a board read from persistence only when this room has no live board.
 * Check and set stay synchronous so a later hydrate continuation cannot roll back
 * a task write that landed after this load started.
 */
function rememberTaskBoardIfAbsent(roomId: string, board: RoomTaskBoardState): RoomTaskBoardState {
  const live = roomTaskBoardState.get(roomId);
  if (live) {
    return live;
  }
  roomTaskBoardState.set(roomId, board);
  return board;
}

function taskBoardHydrateWasReset(roomId: string, epoch: number): boolean {
  return (taskBoardHydrateEpoch.get(roomId) ?? 0) !== epoch;
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
  /**
   * Course details: checkpoints, planned stops, stop plans, map workspace. Wider than race setup so any
   * crew member can fix a checkpoint on race day.
   */
  canEditCourse: boolean;
  canIssueInvite: boolean;
  /** Crew stop edits (manual arrival/departure); aligned with `canEditCheckpointStoppage`. */
  canEditCheckpointStops: boolean;
};

function getPermissions(role: Role): PermissionSet {
  const canEditRaceSetup = role === "athlete" || role === "crew_chief" || role === "team_manager";
  const canEditCourse = canEditRaceSetup || role === "crew_member";
  const canIssueInvite = role === "athlete" || role === "crew_chief" || role === "team_manager";
  return {
    canViewRoom: true,
    canEditRaceSetup,
    canEditCourse,
    canIssueInvite,
    canEditCheckpointStops: canEditCheckpointStoppage(role)
  };
}

function canEditCheckpointStoppage(role: Role): boolean {
  return role === "crew_member" || role === "crew_chief" || role === "team_manager";
}

/** List payload. The bearer token is omitted unless the viewer can issue invites. */
function inviteForViewer(invite: RaceRoomInvite, includeToken: boolean) {
  if (includeToken) {
    return invite;
  }
  return {
    roomId: invite.roomId,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invitedBy,
    invitedAt: invite.invitedAt,
    expiresAt: invite.expiresAt,
    status: invite.status,
    ...(invite.acceptedBy !== undefined ? { acceptedBy: invite.acceptedBy } : {}),
    ...(invite.acceptedAt !== undefined ? { acceptedAt: invite.acceptedAt } : {})
  };
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

export type EntitlementOptions = {
  /**
   * Let the race's runner (`actor === room.athleteId`) through on an unpaid race, so they can
   * set it up before paying. The route must then shape its response with `lib/raceTeaser.ts`.
   * Crew stay at 402, and an expired race stays blocked for everyone.
   */
  allowUnpaidRunner?: boolean;
};

export type EntitlementDecision = {
  allowed: boolean;
  code?: number;
  error?: string;
  /** Allowed through the unpaid-runner exception: the response must be the teaser. */
  teaser?: boolean;
};

export function evaluateEntitlement(
  app: FastifyInstance,
  room: RaceRoom,
  actor: string,
  options: EntitlementOptions = {}
): EntitlementDecision {
  const decision = {
    roomId: room.id,
    actor,
    entitlementStatus: room.entitlement.status
  };

  if (isRoomPaid(room)) {
    app.log.info({ entitlement: { ...decision, allowed: true } }, "entitlement_decision");
    return { allowed: true };
  }

  if (room.entitlement.status === "unpaid") {
    if (options.allowUnpaidRunner === true && actor === room.athleteId) {
      app.log.info({ entitlement: { ...decision, allowed: true, teaser: true } }, "entitlement_decision");
      return { allowed: true, teaser: true };
    }
    app.log.info({ entitlement: { ...decision, allowed: false } }, "entitlement_decision");
    return { allowed: false, code: 402, error: "Entitlement unpaid" };
  }

  app.log.info({ entitlement: { ...decision, allowed: false } }, "entitlement_decision");
  return { allowed: false, code: 403, error: "Entitlement expired" };
}

/** All race rooms for a team id (WS6 aggregate scope). */
export async function listRaceRoomsByTeamId(teamId: string): Promise<RaceRoom[]> {
  if (!isRoomPersistenceEnabled()) {
    return [...raceRooms.values()].filter((r) => r.teamId === teamId);
  }
  const readStartedAt = roomDeleteCount;
  const persisted = ingestPersistedRaceRoomsWithoutClobber(await listPersistedRaceRoomsByTeamId(teamId), readStartedAt);
  return mergeListedRaceRooms(persisted, (r) => r.teamId === teamId);
}

export async function listRaceRoomsForMember(userId: string): Promise<RaceRoom[]> {
  const isMember = (r: RaceRoom) => r.memberships.some((m) => m.userId === userId);
  if (!isRoomPersistenceEnabled()) {
    const sorted = [...raceRooms.values()]
      .filter(isMember)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return Promise.all(sorted.map((r) => ensureJoinCodeBackfill(r)));
  }
  const readStartedAt = roomDeleteCount;
  const persisted = ingestPersistedRaceRoomsWithoutClobber(await listPersistedRaceRoomsForMember(userId), readStartedAt);
  const sorted = mergeListedRaceRooms(persisted, isMember).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
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

/**
 * Rooms whose `raceStartAt` is after `fromMs` and at most `toMs`: the tracking reminder
 * scheduler's candidates. Memory mode scans the in-process rooms. Postgres reads the stored rows,
 * not this instance's cache, so every instance sees the same rooms (R1): an indexed text range
 * on `raceStartAt`, a minute wider on each side, then the parsed time decides. Postgres returns
 * only the fields the scheduler reads, never the whole payload.
 */
export async function listRaceRoomsStartingBetween(fromMs: number, toMs: number): Promise<RaceRoomStartFields[]> {
  const startsInRange = (room: RaceRoomStartFields) => {
    const startMs = Date.parse(room.raceStartAt ?? "");
    return Number.isFinite(startMs) && startMs > fromMs && startMs <= toMs;
  };
  if (!isRoomPersistenceEnabled()) {
    return [...raceRooms.values()].filter(startsInRange);
  }
  // Stored starts are ISO-8601 UTC (`z.iso.datetime()`), which sort by time to the second; the
  // fractional part can differ, so the prefilter is widened and the parse is exact.
  const persisted = await listPersistedRaceRoomsStartingBetween(
    new Date(fromMs - 60_000).toISOString(),
    new Date(toMs + 60_000).toISOString()
  );
  return persisted.filter(startsInRange);
}

function expiryFieldsOf(room: RaceRoom): RaceRoomExpiryFields {
  const creatorId = raceCreatorOf(room);
  return {
    id: room.id,
    entitlementStatus: room.entitlement?.status,
    createdAt: room.createdAt,
    ...(creatorId !== undefined ? { creatorId } : {})
  };
}

/**
 * Unpaid rooms created at or before `createdBeforeMs`, never paid, and whose 1-day reminder
 * (`expiry_1d`) was claimed at or before `finalReminderClaimedBeforeMs`, oldest first, at most
 * `limit`: the unpaid race sweeper's candidates. A room with a billing grant, a refunded one
 * included, was paid once and is never listed, and neither is a room whose creator has an
 * unattached grant (R25: maybe a paying runner whose purchase never reached the race), nor a room
 * whose runner has not had a day since that warning (lib/unpaidRaceReminderScheduler.ts). Memory
 * mode scans the in-process rooms (its store). Postgres reads the stored rows, not this instance's
 * cache (R1), through the unpaid partial index, a day wider than asked (stored times are ISO-8601
 * UTC from `toISOString`; the margin covers any other offset), then the parsed time decides. A
 * room with no parsable `createdAt` is never listed.
 */
export async function listUnpaidRaceRoomsCreatedBefore(
  createdBeforeMs: number,
  limit: number,
  finalReminderClaimedBeforeMs: number
): Promise<RaceRoomExpiryFields[]> {
  const createdMs = (room: RaceRoomExpiryFields) => Date.parse(room.createdAt ?? "");
  const createdInRange = (room: RaceRoomExpiryFields) => {
    const ms = createdMs(room);
    return Number.isFinite(ms) && ms <= createdBeforeMs;
  };
  if (!isRoomPersistenceEnabled()) {
    const unpaid = [...raceRooms.values()]
      .map(expiryFieldsOf)
      .filter((room) => room.entitlementStatus === "unpaid" && createdInRange(room));
    const ids = unpaid.map((room) => room.id);
    const paidOnce = await listRoomIdsWithBillingGrants(ids);
    const boughtUnattached = await listUserIdsWithUnattachedBillingGrants(unpaid.map((room) => room.creatorId));
    const warned = await listUnpaidFinalReminderClaimTimes(ids);
    return unpaid
      .filter((room) => {
        const claimedAtMs = warned.get(room.id);
        return (
          !paidOnce.has(room.id) &&
          !(room.creatorId !== undefined && boughtUnattached.has(room.creatorId)) &&
          claimedAtMs !== undefined &&
          claimedAtMs <= finalReminderClaimedBeforeMs
        );
      })
      .sort((a, b) => createdMs(a) - createdMs(b))
      .slice(0, limit);
  }
  // The query reads billing_grants (migration 0019; created here too when missing).
  await ensureBillingStoreReady();
  const persisted = await listPersistedUnpaidRaceRoomsCreatedBefore(
    new Date(createdBeforeMs + 24 * 60 * 60 * 1000).toISOString(),
    limit,
    new Date(finalReminderClaimedBeforeMs).toISOString()
  );
  return persisted.filter(createdInRange);
}

/**
 * The unpaid-race reminder scheduler's candidates: unpaid rooms never paid (no billing grant)
 * whose creator has no unattached grant (R25), created at or before `createdBeforeMs` without an
 * `expiry_1d` claim, or starting after
 * `startsAfterMs` and at most `startsAtOrBeforeMs` without a `race_soon` claim. Each carries its
 * claims so far. Memory mode scans the in-process rooms. Postgres reads the stored rows, not this
 * instance's cache (R1), through the unpaid partial indexes on `createdAt` and `raceStartAt`, each
 * range a little wider than asked (a day on `createdAt`, a minute on the start), and returns only
 * the scheduler's fields, never the payload; the scheduler decides from the parsed times.
 */
export async function listUnpaidRaceRoomsForReminders(
  createdBeforeMs: number,
  startsAfterMs: number,
  startsAtOrBeforeMs: number
): Promise<RaceRoomReminderFields[]> {
  if (!isRoomPersistenceEnabled()) {
    const unpaid = [...raceRooms.values()].filter((room) => room.entitlement?.status === "unpaid");
    const paidOnce = await listRoomIdsWithBillingGrants(unpaid.map((room) => room.id));
    const boughtUnattached = await listUserIdsWithUnattachedBillingGrants(unpaid.map(raceCreatorOf));
    return unpaid
      .filter((room) => {
        const creatorId = raceCreatorOf(room);
        return !paidOnce.has(room.id) && !(creatorId !== undefined && boughtUnattached.has(creatorId));
      })
      .map((room): RaceRoomReminderFields => {
        const creatorId = raceCreatorOf(room);
        return {
          id: room.id,
          entitlementStatus: room.entitlement.status,
          createdAt: room.createdAt,
          raceStartAt: room.raceStartAt,
          creatorId,
          creatorIsMember: creatorId !== undefined && room.memberships.some((member) => member.userId === creatorId),
          name: room.name,
          claims: memoryUnpaidReminderClaims(room.id)
        };
      })
      .filter((room) => {
        const createdMs = Date.parse(room.createdAt ?? "");
        const startMs = Date.parse(room.raceStartAt ?? "");
        const byCreation = Number.isFinite(createdMs) && createdMs <= createdBeforeMs && !room.claims.expiry_1d;
        const byStart =
          Number.isFinite(startMs) && startMs > startsAfterMs && startMs <= startsAtOrBeforeMs && !room.claims.race_soon;
        return byCreation || byStart;
      });
  }
  // The query reads billing_grants (migration 0019; created here too when missing).
  await ensureBillingStoreReady();
  return listPersistedUnpaidRaceRoomsForReminders(
    new Date(createdBeforeMs + 24 * 60 * 60 * 1000).toISOString(),
    new Date(startsAfterMs - 60_000).toISOString(),
    new Date(startsAtOrBeforeMs + 60_000).toISOString()
  );
}

/**
 * `unpaidExpiresAt` on each unpaid, never-paid room: when the sweeper deletes it
 * (`unpaidRaceExpiresAtMs`: the later of `createdAt` + 30 days and its 1-day reminder's claim +
 * 24 hours). Computed for the response, never stored: returns copies, and `rooms` may be cached
 * objects. Paid, expired and once-paid rooms, a room whose creator has an unattached grant (the
 * sweeper keeps it: R25), and a room with no parsable `createdAt` go out without it.
 * `GET /race-rooms/:roomId` and `GET /race-rooms/mine` send it.
 */
async function withUnpaidExpiresAt(rooms: readonly RaceRoom[]): Promise<RaceRoom[]> {
  const unpaid = rooms.filter((room) => room.entitlement?.status === "unpaid");
  if (unpaid.length === 0) {
    return [...rooms];
  }
  const unpaidIds = unpaid.map((room) => room.id);
  const paidOnce = await listRoomIdsWithBillingGrants(unpaidIds);
  const boughtUnattached = await listUserIdsWithUnattachedBillingGrants(unpaid.map(raceCreatorOf));
  const warned = await listUnpaidFinalReminderClaimTimes(unpaidIds);
  return rooms.map((room) => {
    const creatorId = raceCreatorOf(room);
    if (
      room.entitlement?.status !== "unpaid" ||
      paidOnce.has(room.id) ||
      (creatorId !== undefined && boughtUnattached.has(creatorId))
    ) {
      return room;
    }
    const expiresAtMs = unpaidRaceExpiresAtMs(room.createdAt, warned.get(room.id));
    return expiresAtMs === undefined ? room : { ...room, unpaidExpiresAt: new Date(expiresAtMs).toISOString() };
  });
}

/**
 * Rooms `userId` created that are still `unpaid` and were never paid (the unpaid race limit on
 * `POST /race-rooms`): a room with a billing grant, a refunded one included, doesn't count.
 * Counted from the store every instance shares, never this instance's cache: memory mode's rooms,
 * or the stored rows in Postgres.
 */
export async function countUnpaidRaceRoomsCreatedBy(userId: string): Promise<number> {
  if (!isRoomPersistenceEnabled()) {
    const unpaid = [...raceRooms.values()].filter((room) => countsTowardUnpaidRaceLimit(room, userId));
    const paidOnce = await listRoomIdsWithBillingGrants(unpaid.map((room) => room.id));
    return unpaid.filter((room) => !paidOnce.has(room.id)).length;
  }
  // The query reads billing_grants (migration 0019; created here too when missing).
  await ensureBillingStoreReady();
  return countPersistedUnpaidRaceRoomsCreatedBy(userId);
}

/** Account deletion: every room the user is on, plus rooms where they are the runner. */
export async function listRaceRoomsForAccount(userId: string): Promise<RaceRoom[]> {
  const byId = new Map<string, RaceRoom>();
  for (const room of await listRaceRoomsForMember(userId)) byId.set(room.id, room);
  const owned = isRoomPersistenceEnabled()
    ? await listPersistedRaceRoomsForAthlete(userId)
    : [...raceRooms.values()].filter((room) => room.athleteId === userId);
  for (const room of owned) if (!byId.has(room.id)) byId.set(room.id, room);
  return [...byId.values()];
}

export type RaceRoomDeletion = PersistedRaceRoomDeletion;

/**
 * Decides, from the room as stored right now, whether a conditional delete goes ahead. In Postgres
 * it is asked while the room row is locked, and `db` is that transaction's client: read anything
 * more through it (`roomHasBillingGrants(id, db)`), never through a second pool connection. Memory
 * mode passes no `db`.
 */
export type RaceRoomDeleteCondition = (
  room: RaceRoomExpiryFields,
  db?: PersistenceQueryable
) => boolean | Promise<boolean>;

/**
 * Ask `onlyIf` about the room as stored, under its lock (Postgres: the row locked, then released),
 * and change nothing: `deleted` when it says yes (the room may go), `kept` when it says no, `gone`
 * when there is no room. `deleteRaceRoomAndData` asks this before it removes the room's data that
 * lives outside the room's tables, and {@link deleteRaceRoomRecord} asks again as it deletes.
 */
export async function checkRaceRoomDeleteCondition(
  roomId: string,
  onlyIf: RaceRoomDeleteCondition
): Promise<RaceRoomDeletion> {
  return withRoomRuntimeLock(roomId, async (): Promise<RaceRoomDeletion> => {
    if (isRoomPersistenceEnabled()) {
      return checkPersistedRaceRoomDeleteCondition(roomId, onlyIf);
    }
    // Memory mode: the in-process room is the stored one.
    const live = raceRooms.get(roomId);
    return !live ? "gone" : (await onlyIf(expiryFieldsOf(live))) ? "deleted" : "kept";
  });
}

/**
 * Close a room for everyone (account deletion #560, the unpaid race sweeper). Takes the runtime
 * lock so an in-flight ping, purchase or membership write finishes first, and one queued behind
 * it finds no room. After the room row is gone every room URL returns 404, then the dependents
 * (task board, WS2/4/5 runtime, track, invites, tracking reminder claims) are dropped. Chat,
 * the finished effort and the course-history record live outside this module:
 * `deleteRaceRoomAndData` (lib/raceRoomDeletion.ts) is the full delete and adds them.
 *
 * With `onlyIf`, the room is re-read under the lock (Postgres: the stored row, locked until the
 * delete commits) and deleted only when `onlyIf` returns true; otherwise nothing changes (`kept`).
 * A room that is already gone answers `gone`, not an error, and its in-process copies and
 * dependents are dropped anyway, so a repeat or a second deleter at the same time is harmless.
 */
export async function deleteRaceRoomRecord(
  roomId: string,
  onlyIf?: RaceRoomDeleteCondition
): Promise<RaceRoomDeletion> {
  const outcome = await withRoomRuntimeLock(roomId, async (): Promise<RaceRoomDeletion> => {
    let result: RaceRoomDeletion;
    if (isRoomPersistenceEnabled()) {
      result = await deletePersistedRaceRoomRows(roomId, onlyIf);
    } else {
      // Memory mode: the in-process room is the stored one.
      const live = raceRooms.get(roomId);
      result = !live ? "gone" : onlyIf && !(await onlyIf(expiryFieldsOf(live))) ? "kept" : "deleted";
    }
    if (result === "kept") {
      return result;
    }
    await withExclusiveTail(roomSaveTail, roomId, async () => {
      unindexJoinCodeForRoomId(roomId);
      raceRooms.delete(roomId);
      roomDeletedAtCount.set(roomId, roomDeleteCount);
      roomDeleteCount += 1;
    });
    return result;
  });
  if (outcome === "kept") {
    return outcome;
  }
  for (const [token, invite] of [...raceRoomInvites.entries()]) {
    if (invite.roomId === roomId) raceRoomInvites.delete(token);
  }
  await discardTaskBoardState(roomId);
  await discardWs2Runtime(roomId);
  const { discardWs4RoomState } = await import("./ws4AdaptivePlanRoutes.js");
  await discardWs4RoomState(roomId);
  const { discardWs5RoomState } = await import("./ws5SyncRoutes.js");
  await discardWs5RoomState(roomId);
  // Postgres reminder claims went with the room row (ON DELETE CASCADE); this drops memory mode's.
  forgetTrackingRemindersForRoom(roomId);
  forgetUnpaidRemindersForRoom(roomId);
  roomPingState.delete(roomId);
  roomProjectionState.delete(roomId);
  return outcome;
}

/**
 * Account deletion (#560): drop the user's membership from a room someone else owns, plus any
 * invite they sent, accepted or were addressed to. Returns false if they were not a member.
 */
export async function removeMemberForAccountDeletion(
  roomId: string,
  userId: string,
  email: string | undefined,
  log: FastifyBaseLogger
): Promise<boolean> {
  let removed = false;
  const updated = await commitRaceRoomUpdate(roomId, (latest) => {
    if (!latest.memberships.some((m) => m.userId === userId)) return latest;
    removed = true;
    return { ...latest, memberships: latest.memberships.filter((m) => m.userId !== userId) };
  });
  const invites = isRoomPersistenceEnabled()
    ? await loadRaceRoomInvitesForRoom(roomId)
    : [...raceRoomInvites.values()].filter((invite) => invite.roomId === roomId);
  const normalizedEmail = email?.trim().toLowerCase();
  for (const invite of invites) {
    const addressedToUser = normalizedEmail !== undefined && invite.email.trim().toLowerCase() === normalizedEmail;
    if (invite.invitedBy !== userId && invite.acceptedBy !== userId && !addressedToUser) continue;
    await deletePersistedRaceRoomInvite(invite.token);
    raceRoomInvites.delete(invite.token);
  }
  if (updated && removed) publishChatRoom(roomId, "membership");
  return removed;
}

/**
 * Latest projection view with timeliness, when ping history produced a stored core projection or
 * bootstrap filled state. Freshness counts race pings only: a pre-start ping never makes it fresh.
 */
export async function getProjectionViewForRoom(roomId: string, log?: WarnLog): Promise<RaceRoomProjection | undefined> {
  await loadWs2RuntimeIfNeeded(roomId);
  const room = await getRaceRoom(roomId);
  if (room) {
    await reseedStalePreStartProjectionOnRead(roomId, room, log);
  }
  let stored = roomProjectionState.get(roomId);
  if (!stored && room) {
    await ensureBootstrapProjection(roomId, room, true);
    stored = roomProjectionState.get(roomId);
  }
  if (!stored) {
    return undefined;
  }
  const pingState = getOrInitPingState(roomId);
  const racePing = room ? lastRacePing(pingState, room) : pingState.lastAccepted;
  return attachProjectionTimeliness(
    stored.lastProjectionCore,
    racePing?.recordedAtMs ?? null,
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

/**
 * The crew's check-ins in a projection's splits: the visits with a `manualEntry`, without their
 * auto-detected part, each one the crew's (`manual_crew`). Splits with none are left out. Before
 * the race's first ping these are the only visits that count: an auto visit, and the auto part of
 * a check-in entered over one, came from pings that are pre-start now. Each keeps its
 * `visitIndex`, the one a crew phone refers to it by (`nextVisitIndex`): renumbered, a dropped
 * auto visit's index would name the check-in, and the check-in's another visit.
 */
function crewCheckInSplits(splits: readonly RaceCheckpointSplitRow[]): RaceCheckpointSplitRow[] {
  const kept: RaceCheckpointSplitRow[] = [];
  for (const split of splits) {
    const visits = split.visits
      .filter((visit) => visit.manualEntry !== undefined)
      .map(({ autoDetected: _pingDerived, ...visit }): CheckpointVisit => ({
        ...visit,
        resolvedSource: "manual_crew",
        activeActualStopSeconds: visit.manualEntry?.actualStopSeconds ?? null
      }));
    if (visits.length > 0) {
      kept.push({ ...split, visits });
    }
  }
  return kept;
}

/**
 * Copy visit logs onto a freshly bootstrapped projection (`reseedPreRaceProjection`): after a
 * plan-of-record attach, a course save or a start change before the race's first ping. Matched
 * by checkpoint id (a visited checkpoint cannot be removed); planned splits stay on the new
 * baseline (#487) while closed actuals keep shifting GET `/schedule`.
 */
function restoreProjectionVisitLogs(
  roomId: string,
  previousSplits: readonly RaceCheckpointSplitRow[],
  room: RaceRoom
): void {
  const stored = roomProjectionState.get(roomId);
  const raceAnchor = resolveRaceAnchorIso(room);
  if (!stored || !raceAnchor) {
    return;
  }
  const previousById = new Map(previousSplits.map((row) => [row.checkpointId, row]));
  let restored = false;
  for (const split of stored.lastProjectionCore.checkpointSplits) {
    const previous = previousById.get(split.checkpointId);
    if (!previous || previous.visits.length === 0) {
      continue;
    }
    split.visits = structuredClone(previous.visits);
    refreshCheckpointSplitStoppageDerivedFields(split);
    restored = true;
  }
  if (!restored) {
    return;
  }
  recomputeProjectionStoppageSummary(stored.lastProjectionCore, raceAnchor);
  syncProjectionAccumulatorStateFromCore(stored);
  const routeForLive = resolveRouteMetricPointsFromRaceRoom(room);
  if (routeForLive) {
    stored.lastProjectionCore = enrichProjectionWithLiveRemaining(
      stored.lastProjectionCore,
      room,
      routeForLive,
      raceAnchor
    );
  }
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
  state: Pick<RoomProjectionState, "splitCrossedAt" | "visitStates" | "visitMeta" | "lastProgressMeters" | "rollingMovingSpeedMps" | "liveRatio">,
  allowedCheckpointIds: Set<string>
): Pick<RoomProjectionState, "splitCrossedAt" | "visitStates" | "visitMeta" | "lastProgressMeters" | "rollingMovingSpeedMps" | "liveRatio"> {
  return {
    lastProgressMeters: state.lastProgressMeters,
    rollingMovingSpeedMps: state.rollingMovingSpeedMps,
    ...(state.liveRatio ? { liveRatio: { ...state.liveRatio } } : {}),
    splitCrossedAt: Object.fromEntries(Object.entries(state.splitCrossedAt).filter(([id]) => allowedCheckpointIds.has(id))),
    visitStates: Object.fromEntries(Object.entries(state.visitStates).filter(([id]) => allowedCheckpointIds.has(id))),
    visitMeta: Object.fromEntries(Object.entries(state.visitMeta).filter(([id]) => allowedCheckpointIds.has(id)))
  };
}

/**
 * Visit accumulators without the auto visits that arrived before the race start: pings that are
 * pre-start now made them (the start moved later than them). The crew's check-ins stay (a visit
 * with a `manualEntry`), each with its own `visitIndex` (`nextVisitIndex`). Under a start that has
 * not moved this drops nothing: a pre-start ping never folds in, so no auto visit opens before the
 * start.
 */
function withoutPreStartAutoVisits(
  state: Pick<RoomProjectionState, "visitStates" | "visitMeta">,
  room: RaceRoom
): Pick<RoomProjectionState, "visitStates" | "visitMeta"> {
  const visitStates: RoomProjectionState["visitStates"] = {};
  const visitMeta: RoomProjectionState["visitMeta"] = { ...state.visitMeta };
  for (const [checkpointId, visits] of Object.entries(state.visitStates)) {
    const metadata = state.visitMeta[checkpointId] ?? [];
    const keptVisits: RoomProjectionState["visitStates"][string] = [];
    const keptMetadata: RoomProjectionState["visitMeta"][string] = [];
    visits.forEach((visit, index) => {
      const meta = metadata[index];
      const arrivalMs = visit.arrivalRecordedAt ? Date.parse(visit.arrivalRecordedAt) : Number.NaN;
      if (meta?.manualEntry === undefined && Number.isFinite(arrivalMs) && isPreStartPing(room, arrivalMs)) {
        return;
      }
      keptVisits.push({ ...visit });
      keptMetadata.push(meta ? { ...meta } : { visitIndex: index + 1, resolvedSource: "auto" });
    });
    delete visitMeta[checkpointId];
    if (keptVisits.length > 0) {
      visitStates[checkpointId] = keptVisits;
    }
    if (keptMetadata.length > 0) {
      visitMeta[checkpointId] = keptMetadata;
    }
  }
  return { visitStates, visitMeta };
}

async function recomputeStoredProjectionAfterCourseChange(roomId: string, room: RaceRoom): Promise<void> {
  const anchor = resolveRaceAnchorIso(room);
  if (!anchor || !room.course || room.plannedPaceSecondsPerKm === undefined) {
    return;
  }
  // Recompute over the last race ping. Before the race's first one (pre-start pings do not count)
  // the caller seeds the bootstrap instead.
  const last = lastRacePing(getOrInitPingState(roomId), room);
  if (!last) {
    return;
  }
  const routeMetricPoints = resolveRouteMetricPointsFromRaceRoom(room);
  if (!routeMetricPoints) {
    roomProjectionState.delete(roomId);
    return;
  }
  const prev = roomProjectionState.get(roomId);
  const ping: ProjectionPing = {
    pingId: last.pingId,
    latitude: last.latitude,
    longitude: last.longitude,
    recordedAt: new Date(last.recordedAtMs).toISOString()
  };
  // An auto visit a pre-start ping made (the start moved later than it) does not carry over.
  const previous = prev
    ? {
        lastProgressMeters: prev.lastProgressMeters,
        splitCrossedAt: { ...prev.splitCrossedAt },
        ...withoutPreStartAutoVisits(structuredClone({ visitStates: prev.visitStates, visitMeta: prev.visitMeta }), room),
        rollingMovingSpeedMps: prev.rollingMovingSpeedMps,
        ...(prev.liveRatio ? { liveRatio: { ...prev.liveRatio } } : {})
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
  const enrichedCore = enrichProjectionWithLiveRemaining(
    nextProjectionCore,
    room,
    routeMetricPoints,
    anchor
  );
  const allowed = new Set(room.course.checkpoints.map((c) => c.id));
  const prunedBase = pruneProjectionStateMaps(nextStateRaw, allowed);
  roomProjectionState.set(roomId, {
    ...prunedBase,
    lastProjectionCore: enrichedCore
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

/** Longest an invite may stay open. Also the default when the issuer sets none. */
export const INVITE_MAX_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7;
const INVITE_DEFAULT_LIFETIME_MS = 1000 * 60 * 60 * 24;

/** An invite counts only while the person who issued it could still issue it. */
function inviterStillAllowed(room: RaceRoom, invite: RaceRoomInvite): boolean {
  if (invite.invitedBy === room.athleteId) return true;
  const inviter = room.memberships.find((member) => member.userId === invite.invitedBy);
  return Boolean(inviter && getPermissions(inviter.role).canIssueInvite);
}

/**
 * Someone the owner removed may come back only through an invite the owner issued after the
 * removal. Returns false when the user is removed and this invite (or a code join) can't readmit them.
 */
function readmits(room: RaceRoom, removedAt: string | undefined, invite?: RaceRoomInvite): boolean {
  if (removedAt === undefined) return true;
  if (!invite || invite.invitedBy !== room.athleteId) return false;
  return Date.parse(invite.invitedAt) > Date.parse(removedAt);
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

/** The length an unpaid teaser locks its checkpoints by, as the teaser schedule does (`scheduleCourseLengthOf`). */
function teaserLockLengthMeters(room: RaceRoom): number {
  return scheduleCourseLengthOf(room, resolveRouteMetricPointsFromRaceRoom(room));
}

/** Full route polyline for projection / course metrics; null if missing or degenerate. */
export function resolveRouteMetricPointsFromRaceRoomExport(room: RaceRoom): CourseMetricPoint[] | null {
  return resolveRouteMetricPointsFromRaceRoom(room);
}

/**
 * Overlay live remaining-course micro-model ETAs onto a projection core (frozen plan vs live).
 * On failure, returns the core unchanged so GPS split math still ships.
 */
function enrichProjectionWithLiveRemaining(
  core: RaceRoomProjectionCore,
  room: RaceRoom,
  routeMetricPoints: CourseMetricPoint[],
  raceAnchorIso: string
): RaceRoomProjectionCore {
  if (!room.course || typeof room.plannedPaceSecondsPerKm !== "number") {
    return core;
  }
  if (isProjectionTunedConstantsEnabled()) {
    // The tuned projection already wrote live remaining ETAs from the runner's own pace.
    return core;
  }
  try {
    const raceStartMs = Date.parse(raceAnchorIso);
    const recordedMs = Date.parse(core.asOfRecordedAt);
    if (Number.isNaN(raceStartMs) || Number.isNaN(recordedMs)) {
      return core;
    }
    const actualElapsedSeconds = Math.max(0, (recordedMs - raceStartMs) / 1000);
    const live = computeLiveRemainingProjection({
      routeMetricPoints,
      checkpoints: room.course.checkpoints,
      courseLengthMeters: core.courseLengthMeters,
      progressMeters: core.progressMeters,
      actualElapsedSeconds,
      raceStartAtIso: raceAnchorIso,
      recordedAtIso: core.asOfRecordedAt,
      plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
      frozenBaselineTrack: room.course.baselineTrack,
      remainingPlannedStoppageSecondsAhead: core.stoppageSummary.remainingPlannedStopSeconds
    });
    return {
      ...core,
      // Keep anchored plan-pace / baseline-track finish on etaFinishPlanIso.
      // Live remaining-course ETAs are additive on remainingCheckpointEtas.
      remainingCheckpointEtas: live.remainingCheckpointEtas
    };
  } catch {
    return core;
  }
}

/**
 * A finished CrewCue race becomes a course-history event (source `crewcue`, one effort), built
 * from the runner's stored track. Later rooms on the same course auto-link to it.
 */
async function recordCrewCueCourseHistory(
  room: RaceRoom,
  routeMetricPoints: CourseMetricPoint[],
  raceAnchorIso: string
): Promise<void> {
  if (!room.course) return;
  const rows = await listTrackPoints(room.id, undefined, 100_000);
  const event = crewCueRoomToCourseHistoryEvent({
    roomId: room.id,
    name: room.name,
    raceStartAt: raceAnchorIso,
    course: room.course,
    routeMetricPoints,
    track: rows.map((row) => ({
      recordedAt: new Date(row.recordedAtMs).toISOString(),
      latitude: row.latitude,
      longitude: row.longitude
    }))
  });
  if (event) {
    await importCourseHistoryEvents([event]);
  }
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

/**
 * The route line the projection follows, as a comparable string ("null" when there is none). The
 * race lock compares it before and after an edit: the same line is an aid-station edit, a new one
 * is another race.
 */
function routeLineSignature(room: RaceRoom): string {
  return JSON.stringify(resolveRouteMetricPointsFromRaceRoom(room));
}

/**
 * Whether the race lock refuses a `PUT /course` (see raceLock.ts): on a locked race, a start the
 * lock does not allow, a different stored GPX, or a different route line. The same route with new
 * checkpoints or aid-station names goes through.
 */
function coursePutRefusedByLock(room: RaceRoom, input: z.infer<typeof updateRaceCourseInput>): boolean {
  const nowMs = Date.now();
  if (!isRaceLocked(room, nowMs)) {
    return false;
  }
  if (!raceStartChangeAllowed(room, input.raceStartAt, nowMs)) {
    return true;
  }
  if (input.courseGpxXml !== undefined && input.courseGpxXml !== room.courseGpxXml) {
    return true;
  }
  if (!input.routeOverlayLayer) {
    return false;
  }
  const merged = mergePrimaryCourseRouteLayer(
    resolveMapWorkspace(room),
    input.routeOverlayLayer,
    room.course?.checkpoints ?? []
  );
  return routeLineSignature({ ...room, mapWorkspace: merged }) !== routeLineSignature(room);
}

function raceLockedReply(reply: FastifyReply) {
  return reply.code(409).send({ error: RACE_LOCKED_ERROR, code: RACE_LOCKED_CODE });
}

/**
 * Store the race lock once race pings reach the first aid station (see raceLock.ts), read from the
 * projection those pings just recomputed. Caller holds the room runtime lock. Writes only once; a
 * failed write is retried by the next ping.
 */
async function lockRaceAtFirstAid(log: FastifyBaseLogger, room: RaceRoom): Promise<void> {
  const crossings = roomProjectionState.get(room.id)?.splitCrossedAt;
  if (!crossings || !aidStationLockAt(room, crossings)) {
    return;
  }
  try {
    // Re-read so the write carries any room field saved since `room` was read.
    const latest = (await getRaceRoom(room.id)) ?? room;
    const lockedAt = aidStationLockAt(latest, crossings);
    if (!lockedAt) {
      return;
    }
    await saveRaceRoom({ ...latest, raceLockedAt: lockedAt });
  } catch (err) {
    log.warn({ err, roomId: room.id }, "race_lock_write_failed");
  }
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

/** ~1.1 m. Ignores float noise from re-projection so a metadata save does not look like a moved pin. */
const COURSE_SHAPE_COORD_DECIMALS = 1e5;

function roundCourseShapeCoord(value: number): number {
  return Math.round(value * COURSE_SHAPE_COORD_DECIMALS) / COURSE_SHAPE_COORD_DECIMALS;
}

/**
 * Identity of the course shape that task assignments, protocol notes, and incidents hang off.
 * Cutoff, title, tags, planned stop, pace, baseline, and derived metrics are not part of this
 * key: editing them on Pace must not delete that operational data.
 */
function courseOperationalResetSignature(course: RaceCourse | undefined): string {
  const checkpoints = course?.checkpoints ?? [];
  return stableStringify(
    checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      latitude: roundCourseShapeCoord(checkpoint.latitude),
      longitude: roundCourseShapeCoord(checkpoint.longitude)
    }))
  );
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

export async function requireCourseEditor(
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
  if (!getPermissions(membership.role).canEditCourse) {
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

/**
 * Place a newly POSTed waypoint by unconstrained route progress. Appending then running
 * {@link checkpointsWithProjectedDistances} would clamp it to the finish because that helper
 * is forward-only in array order.
 */
function insertCheckpointAlongCourse(
  existing: RaceCourseCheckpoint[],
  nextCheckpoint: RaceCourseCheckpoint,
  routePts: CourseMetricPoint[] | null
): RaceCourseCheckpoint[] {
  if (existing.length === 0 || !routePts || routePts.length < 2) {
    return [...existing, nextCheckpoint];
  }
  const progress = geodesicProjectPointToPolyline(routePts, nextCheckpoint).progressMeters;
  let insertAt = existing.length;
  // Never displace the official start (index 0); insert before the first later stop already past this progress.
  for (let index = 1; index < existing.length; index += 1) {
    const stored = existing[index]!.distanceMetersFromStart;
    const along =
      typeof stored === "number" && Number.isFinite(stored)
        ? stored
        : geodesicProjectPointToPolyline(routePts, existing[index]!).progressMeters;
    if (progress < along) {
      insertAt = index;
      break;
    }
  }
  const next = existing.slice();
  next.splice(insertAt, 0, nextCheckpoint);
  return next;
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
  await loadWs2RuntimeIfNeeded(roomId);
  // Save before wiping dependents, as PUT /course does: a failed save must not leave the
  // task board, adaptive plan and sync deleted while the room keeps its previous course.
  // Re-read under the lock so this course edit does not persist a membership list from
  // before the runtime load (a join in that gap would otherwise 200 and then vanish).
  const persistedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
    const withCourse: RaceRoom = {
      ...latest,
      course: updatedRoom.course,
      courseDistanceMeters: updatedRoom.courseDistanceMeters,
      courseElevationGainMeters: updatedRoom.courseElevationGainMeters,
      courseElevationLossMeters: updatedRoom.courseElevationLossMeters
    };
    return updatedRoom.course
      ? syncWorkspaceCheckpoints(withCourse, updatedRoom.course.checkpoints)
      : withCourse;
  });
  if (!persistedRoom) {
    throw new Error("Race room not found");
  }
  const nextCourse = persistedRoom.course;
  const nextPace = updatedRoom.plannedPaceSecondsPerKm;
  if (nextCourse && nextPace !== undefined) {
    const shouldResetCourseDependentState = courseDependentStateNeedsReset({
      previousRoom,
      nextCourse,
      routeOverlayLayer: undefined
    });
    if (shouldResetCourseDependentState) {
      await discardTaskBoardState(roomId);
      const { discardWs4RoomState } = await import("./ws4AdaptivePlanRoutes.js");
      await discardWs4RoomState(roomId);
      const { discardWs5RoomState } = await import("./ws5SyncRoutes.js");
      await discardWs5RoomState(roomId);
    }
  }
  await recomputeProjectionAfterCourseSave(app, roomId, persistedRoom);
}

/**
 * After a course save. Course-shape writes used to drop the in-memory projection whenever no GPS
 * ping had been accepted, then bootstrap empty splits: closed check-ins live only in that
 * projection, so adding/removing an unvisited waypoint (or re-saving the course) silently
 * destroyed visits and reverted GET /schedule ETAs to plan. Before the race's first ping the
 * projection is re-seeded for the new course and start with the crew's check-ins put back; with
 * one, it is recomputed over the last (`recomputeProjectionForRoomChange`). A save that moved the
 * start passes the start before it (`previousAnchorIso`), so the start crossing moves as on
 * PATCH /race-start.
 */
async function recomputeProjectionAfterCourseSave(
  app: FastifyInstance,
  roomId: string,
  updatedRoom: RaceRoom,
  previousAnchorIso?: string
): Promise<void> {
  await recomputeProjectionForRoomChange(
    roomId,
    updatedRoom,
    (err) => app.log.warn({ err, roomId }, "projection_recompute_after_course_failed"),
    previousAnchorIso
  );
}

/**
 * After the race start moved (`PATCH /race-start`), under the room runtime lock so a ping cannot
 * fold in between. Pings are judged against the new start. With no race ping yet, the projection
 * is re-seeded at the new start with only the crew's check-ins kept: a ping the move made
 * pre-start leaves no position, crossing or auto visit behind (`reseedPreRaceProjection`). With
 * race pings, it is recomputed over the last one, without the auto visits pre-start pings made,
 * and the start crossing, which is the old start, moves to the new one (`reanchorStartCrossing`,
 * as on a course save that moves the start). The schedule reads `raceStartAt` on every GET.
 */
async function recomputeProjectionAfterRaceStartChange(
  log: FastifyBaseLogger,
  roomId: string,
  room: RaceRoom,
  previousAnchorIso: string | undefined
): Promise<void> {
  await withRoomRuntimeLock(roomId, async () => {
    await loadWs2RuntimeIfNeeded(roomId);
    const latest = (await getRaceRoom(roomId)) ?? room;
    await recomputeProjectionForRoomChange(
      roomId,
      latest,
      (err) => log.warn({ err, roomId }, "projection_recompute_after_race_start_failed"),
      previousAnchorIso
    );
  });
}

function courseDependentStateNeedsReset(input: {
  previousRoom: RaceRoom;
  nextCourse: RaceCourse;
  routeOverlayLayer: MapWorkspaceLayer | undefined;
}): boolean {
  if (input.routeOverlayLayer) {
    return true;
  }
  return (
    courseOperationalResetSignature(input.previousRoom.course) !==
    courseOperationalResetSignature(input.nextCourse)
  );
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

/**
 * Test-only: backdate a room's `createdAt` (the unpaid race sweeper's clock), or drop it with
 * `undefined` as on a malformed stored payload. Writes the store, Postgres included.
 */
export async function setRaceRoomCreatedAtForTests(roomId: string, createdAt: string | undefined): Promise<void> {
  const mode = process.env.PERSISTENCE_MODE;
  if (mode !== "memory" && mode !== "postgres") {
    throw new Error(
      `setRaceRoomCreatedAtForTests is test-only; use PERSISTENCE_MODE=memory or postgres (got ${mode ?? "unset"})`
    );
  }
  await commitRaceRoomUpdate(roomId, (latest) => {
    const next = { ...latest, createdAt } as RaceRoom;
    if (createdAt === undefined) {
      delete (next as Partial<RaceRoom>).createdAt;
    }
    return next;
  });
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
      // Answer from the room as it is now, never the stored body: the race may have been set
      // up, paid and refunded since, and the stored body was shaped for its state back then.
      const stored = idemCreate.body as RaceRoom | undefined;
      const current = typeof stored?.id === "string" ? ((await getRaceRoom(stored.id)) ?? stored) : stored;
      if (!current?.memberships?.some((member) => member.userId === request.identity?.sub)) {
        return reply.code(409).send({ error: "Idempotency-Key collides with an existing race room" });
      }
      return reply.code(idemCreate.statusCode).send(roomForViewer(current, request.identity.sub));
    }
    if (idemCreate.kind === "conflict" || idemCreate.kind === "in_progress") {
      return idempotencyErrorReply(reply, idemCreate);
    }

    const idempotencyKey = readIdempotencyKey(request);
    const roomId = idempotencyKey
      ? deterministicRaceRoomId(request.identity.sub, idempotencyKey)
      : randomUUID();

    // Reclaim/retry after persist+release (or stale lease) must return the same room.
    if (idempotencyKey) {
      const existing = await getRaceRoom(roomId);
      if (existing) {
        const isMember = existing.memberships.some((member) => member.userId === request.identity?.sub);
        if (!isMember) {
          await releaseIdempotentMutation(request, parsed.data);
          return reply.code(409).send({ error: "Idempotency-Key collides with an existing race room" });
        }
        const body = roomForViewer(existing, request.identity.sub);
        await completeIdempotentMutation(request, parsed.data, 201, body);
        return reply.code(201).send(body);
      }
    }

    const creatorId = request.identity.sub;
    // Count and save one create at a time per creator on this instance, so two creates at once
    // can't both take the last unpaid slot. Instances don't share this lock (R1): creates sent
    // to two instances at the same moment can each pass the count.
    return withExclusiveTail(roomCreateTail, creatorId, async () => {
      let limitError: ReturnType<typeof unpaidRaceLimitError>;
      try {
        limitError = unpaidRaceLimitError(await countUnpaidRaceRoomsCreatedBy(creatorId));
      } catch (err) {
        await releaseIdempotentMutation(request, parsed.data);
        throw err;
      }
      if (limitError) {
        // Released, not stored: the same key works once a race is unlocked or expires.
        await releaseIdempotentMutation(request, parsed.data);
        return reply.code(409).send(limitError);
      }
      const createDelay = roomCreateDelayForTests;
      if (createDelay) {
        roomCreateDelayForTests = undefined;
        await createDelay();
      }

      const now = new Date().toISOString();
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
        createdByUserId: creatorId,
        entitlement: {
          status: "unpaid",
          lastUpdatedAt: now,
          source: "manual",
          crewTier: "one"
        },
        memberships: [
          {
            userId: creatorId,
            role: parsed.data.creatorRole,
            joinedAt: now
          }
        ]
      };

      const body = roomForViewer(room, creatorId);
      let roomPersisted = false;
      try {
        await saveRaceRoom(room);
        roomPersisted = true;
        await completeIdempotentMutation(request, parsed.data, 201, body);
        return reply.code(201).send(body);
      } catch (err) {
        if (!roomPersisted) {
          await releaseIdempotentMutation(request, parsed.data);
          throw err;
        }
        // Room is durable — do not release the lease (that created orphans on retry).
        try {
          await completeIdempotentMutation(request, parsed.data, 201, body);
        } catch (completeErr) {
          request.log.warn(
            { err: completeErr, roomId: room.id },
            "idempotency complete failed after race room save"
          );
        }
        return reply.code(201).send(body);
      }
    });
  });

  app.get("/race-rooms/mine", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const viewer = request.identity.sub;
    const rooms = await listRaceRoomsForMember(viewer);
    return reply.send({ rooms: await withUnpaidExpiresAt(rooms.map((room) => roomForViewer(room, viewer))) });
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

    // The runner sets up an unpaid race before paying; they see the teaser, crew get 402.
    const entitlement = evaluateEntitlement(app, room, request.identity.sub, { allowUnpaidRunner: true });
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    const permissions = getPermissions(membership.role);
    const [shaped] = await withUnpaidExpiresAt([roomForViewer(room, request.identity.sub)]);
    return reply.send({ room: shaped, permissions });
  });

  /**
   * Rename the race. Same gates as a course save: race-setup editors, the runner on an unpaid race
   * included, crew on an unpaid race 402. Open on a locked race (see raceLock.ts): a name is not
   * the course. Crew clients pick the new name up on their next room or race-list read.
   */
  app.patch("/race-rooms/:roomId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const viewer = request.identity.sub;
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const membership = room.memberships.find((member) => member.userId === viewer);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!getPermissions(membership.role).canEditRaceSetup) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }
    const entitlement = evaluateEntitlement(app, room, viewer, { allowUnpaidRunner: true });
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }
    const parsed = renameRaceRoomInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Race name must be 1 to 80 characters." });
    }
    const updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => ({ ...latest, name: parsed.data.name }));
    if (!updatedRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    return reply.send(roomForViewer(updatedRoom, viewer));
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

    // Course setup is part of the runner's onboarding, before they pay.
    const entitlement = evaluateEntitlement(app, room, request.identity.sub, { allowUnpaidRunner: true });
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }
    const parsed = updateRaceCourseInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid course payload" });
    }
    // A used race keeps its route and start; aid-station edits on the same route go through.
    if (coursePutRefusedByLock(room, parsed.data)) {
      return raceLockedReply(reply);
    }

    const idemCourse = await beginIdempotentMutation(request, parsed.data);
    if (idemCourse.kind === "replay") {
      // Answer from the room as it is now, shaped for this caller, never the stored body: a
      // body stored while paid must not replay the whole plan after a refund.
      const current = (await getRaceRoom(roomId)) ?? room;
      return reply.code(idemCourse.statusCode).send(roomForViewer(current, request.identity.sub));
    }
    if (idemCourse.kind === "conflict" || idemCourse.kind === "in_progress") {
      return idempotencyErrorReply(reply, idemCourse);
    }

    let idemCourseFinished = false;
    let coursePersisted = false;
    // Release the key before replying. Releasing in `finally` ran after the 400 was already
    // sent, so a client that fixed its payload and retried at once got a 409 for a request
    // that never wrote anything.
    const releaseBeforeReply = async () => {
      idemCourseFinished = true;
      await releaseIdempotentMutation(request, parsed.data);
    };
    const rejectBeforeWrite = async (body: { error: string }) => {
      await releaseBeforeReply();
      return reply.code(400).send(body);
    };
    // Saves on an unpaid race are capped per user (429 past it); paid saves are not. The route
    // limits cannot see entitlement, so the handler applies it with the same counters. Only a save
    // that writes counts: not a rejected payload, an idempotent replay, or a save refused before
    // the write. A spent budget is refused here, before the course is recomputed; the save is
    // counted just before it writes.
    const unpaidSave = isTeaserRoom(room);
    const overUnpaidSaveLimit = async (count: boolean) =>
      unpaidSave &&
      !(await app.enforceRateLimit(request, reply, "unpaidCourseSave", { count, beforeReply: releaseBeforeReply }));
    if (await overUnpaidSaveLimit(false)) {
      return reply;
    }
    try {
    await loadWs2RuntimeIfNeeded(roomId);
    const prevProjection = roomProjectionState.get(roomId);
    if (prevProjection) {
      const visitedIds = visitedCheckpointIdsFromStoredProjection(prevProjection);
      const nextIds = new Set(parsed.data.course.checkpoints.map((c) => c.id));
      for (const id of visitedIds) {
        if (!nextIds.has(id)) {
          return await rejectBeforeWrite({ error: `Cannot remove visited checkpoint: ${id}` });
        }
      }
    }

    let recomputedCourse: RaceCourse;
    if (parsed.data.course.checkpoints.length >= 2) {
      const routePts = resolveRouteMetricPointsForCoursePut(room, parsed.data.routeOverlayLayer);
      if (!routePts) {
        return await rejectBeforeWrite({
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
        return await rejectBeforeWrite({ error: "Course route data is invalid or could not be processed." });
      }
    } else {
      recomputedCourse = recomputeCourseMetricsForSave({
        course: parsed.data.course,
        plannedPaceSecondsPerKm: parsed.data.plannedPaceSecondsPerKm
      });
    }

    if (await overUnpaidSaveLimit(true)) {
      return reply;
    }

    let shouldResetCourseDependentState = false;
    let previousAnchorIso: string | undefined;
    // Persist the course before wiping dependents. Otherwise a failed save after
    // deleteTaskBoard*/deleteWs* leaves boards/sync gone while the room is unchanged.
    // `room` was read before idempotency and the runtime load. Overlay the new course
    // onto the live room so a join in that gap stays on the roster.
    let updatedRoom: RaceRoom | undefined;
    try {
    updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
      // Checked again under the room lock: a ping may have locked the race since the read above.
      if (coursePutRefusedByLock(latest, parsed.data)) {
        throw new RaceLockedError();
      }
      previousAnchorIso = resolveRaceAnchorIso(latest);
      let next: RaceRoom = {
        ...latest,
        course: recomputedCourse,
        plannedPaceSecondsPerKm: parsed.data.plannedPaceSecondsPerKm,
        courseDistanceMeters:
          recomputedCourse.derivedMetrics?.canonicalDistanceMeters ?? latest.courseDistanceMeters,
        courseElevationGainMeters:
          recomputedCourse.derivedMetrics?.elevationGainMeters ?? latest.courseElevationGainMeters,
        courseElevationLossMeters:
          recomputedCourse.derivedMetrics?.elevationLossMeters ?? latest.courseElevationLossMeters,
        courseFileName: parsed.data.courseFileName ?? latest.courseFileName,
        courseGpxXml: parsed.data.courseGpxXml ?? latest.courseGpxXml,
        raceStartAt: parsed.data.raceStartAt,
        activatedAt: parsed.data.raceStartAt
      };
      // A start that moved takes the plan of record's clocks with it, as PATCH /race-start does.
      if (next.pacingEstimate && Date.parse(latest.raceStartAt ?? "") !== Date.parse(parsed.data.raceStartAt)) {
        next.pacingEstimate = estimateAtStart(next.pacingEstimate, parsed.data.raceStartAt);
      }

      if (parsed.data.routeOverlayLayer) {
        const mergedWorkspace = mergePrimaryCourseRouteLayer(
          resolveMapWorkspace(next),
          parsed.data.routeOverlayLayer,
          recomputedCourse.checkpoints
        );
        next = { ...next, mapWorkspace: mergedWorkspace };
        // New GPX / route overlay is a different course. The attached plan-of-record estimate
        // (and its aid ETAs) were computed for the previous polyline; keeping it would leave
        // GET /schedule on the old race's clocks. Drop it so the next schedule view can
        // auto-create a fresh estimate for this geometry (#481 attach + replace-file).
        if (next.pacingEstimate !== undefined || next.pacingEstimateId !== undefined) {
          delete next.pacingEstimate;
          delete next.pacingEstimateId;
        }
      }

      shouldResetCourseDependentState = courseDependentStateNeedsReset({
        previousRoom: latest,
        nextCourse: recomputedCourse,
        routeOverlayLayer: parsed.data.routeOverlayLayer
      });
      return next;
    });
    } catch (err) {
      if (err instanceof RaceLockedError) {
        await releaseBeforeReply();
        return raceLockedReply(reply);
      }
      throw err;
    }
    if (!updatedRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }
      coursePersisted = true;

    if (shouldResetCourseDependentState) {
      await discardTaskBoardState(roomId);
      const { discardWs4RoomState } = await import("./ws4AdaptivePlanRoutes.js");
      await discardWs4RoomState(roomId);
      const { discardWs5RoomState } = await import("./ws5SyncRoutes.js");
      await discardWs5RoomState(roomId);
    }

      // A save that moved the start moves the start crossing too, as PATCH /race-start does.
      await recomputeProjectionAfterCourseSave(app, roomId, updatedRoom, previousAnchorIso);
      // The unpaid runner gets the teaser here too. A replay re-reads the room instead of
      // sending this body, but it is stored shaped all the same.
      const body = roomForViewer(updatedRoom, request.identity.sub);
      await completeIdempotentMutation(request, parsed.data, 200, body);
      idemCourseFinished = true;
      return reply.send(body);
    } finally {
      // Never release after a durable course write — retry/reclaim must not treat
      // a partially completed PUT as a fresh mutation that can wipe again freely.
      if (!idemCourseFinished && !coursePersisted) {
        await releaseIdempotentMutation(request, parsed.data);
      }
    }
  });

  /**
   * Set or change the race start without re-sending the course: onboarding sets it, the runner
   * included on an unpaid race (the reply is then the teaser). Same gates as PUT /course: course
   * editors, the unpaid runner let through, crew on an unpaid race 402. `raceStartAt` and
   * `activatedAt` move together, as on a course save; the projection is re-seeded at the new
   * start and the schedule reads it. On an unpaid race a write counts toward the course-save
   * budget (`unpaidCourseSave`). An Idempotency-Key replay answers the room as it is now, shaped
   * for the caller.
   */
  app.patch("/race-rooms/:roomId/race-start", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const viewer = request.identity.sub;
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    const membership = room.memberships.find((member) => member.userId === viewer);
    if (!membership) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (!getPermissions(membership.role).canEditRaceSetup) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }
    // The start is part of the runner's onboarding, before they pay.
    const entitlement = evaluateEntitlement(app, room, viewer, { allowUnpaidRunner: true });
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }
    const parsed = updateRaceStartInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid race start payload" });
    }
    // A used race keeps its start, give or take a delayed gun (raceStartChangeAllowed). Sending the
    // stored start again is a no-op and goes through.
    if (!raceStartChangeAllowed(room, parsed.data.raceStartAt, Date.now())) {
      return raceLockedReply(reply);
    }

    const idem = await beginIdempotentMutation(request, parsed.data);
    if (idem.kind === "replay") {
      // As PUT /course: the room as it is now, shaped for this caller, never the stored body.
      const current = (await getRaceRoom(roomId)) ?? room;
      return reply.code(idem.statusCode).send(roomForViewer(current, viewer));
    }
    if (idem.kind === "conflict" || idem.kind === "in_progress") {
      return idempotencyErrorReply(reply, idem);
    }

    let idemFinished = false;
    let startPersisted = false;
    const releaseBeforeReply = async () => {
      idemFinished = true;
      await releaseIdempotentMutation(request, parsed.data);
    };
    try {
      // Counted just before the write, as a course save is; past the budget it is 429 and the key
      // is released.
      if (
        isTeaserRoom(room) &&
        !(await app.enforceRateLimit(request, reply, "unpaidCourseSave", { beforeReply: releaseBeforeReply }))
      ) {
        return reply;
      }
      let previousAnchorIso: string | undefined;
      // The plan of record's clocks (finish, bands, aid ETAs) move with the start.
      let updatedRoom: RaceRoom | undefined;
      try {
        updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
          if (!raceStartChangeAllowed(latest, parsed.data.raceStartAt, Date.now())) {
            throw new RaceLockedError();
          }
          previousAnchorIso = resolveRaceAnchorIso(latest);
          return withRaceStart(latest, parsed.data.raceStartAt);
        });
      } catch (err) {
        if (err instanceof RaceLockedError) {
          await releaseBeforeReply();
          return raceLockedReply(reply);
        }
        throw err;
      }
      if (!updatedRoom) {
        return reply.code(404).send({ error: "Race room not found" });
      }
      startPersisted = true;
      await recomputeProjectionAfterRaceStartChange(request.log, roomId, updatedRoom, previousAnchorIso);
      const body = roomForViewer(updatedRoom, viewer);
      await completeIdempotentMutation(request, parsed.data, 200, body);
      idemFinished = true;
      return reply.send(body);
    } finally {
      // As PUT /course: never release after the start is written, so a retry replays.
      if (!idemFinished && !startPersisted) {
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
    const rebuilt = rebuildRoomCourseFromCheckpoints(
      room,
      insertCheckpointAlongCourse(
        room.course.checkpoints,
        nextCheckpoint,
        resolveRouteMetricPointsFromRaceRoom(room)
      )
    );
    if (!rebuilt.ok) {
      return reply.code(400).send({ error: rebuilt.error });
    }
    await persistCourseShapeChange(app, roomId, room, rebuilt.room);
    return reply.code(201).send(roomForViewer(rebuilt.room, request.identity?.sub));
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

    let checkpointMissing = false;
    const updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
      if (!latest.course?.checkpoints.some((checkpoint) => checkpoint.id === checkpointId)) {
        checkpointMissing = true;
        return latest;
      }
      const nextCheckpoints = latest.course.checkpoints.map((checkpoint) => {
        if (checkpoint.id !== checkpointId) {
          return checkpoint;
        }
        return {
          ...checkpoint,
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {})
        };
      });
      return syncWorkspaceCheckpoints(
        { ...latest, course: { ...latest.course, checkpoints: nextCheckpoints } },
        nextCheckpoints
      );
    });
    if (!updatedRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (checkpointMissing) {
      return reply.code(404).send({ error: "Checkpoint not found" });
    }
    return reply.send(roomForViewer(updatedRoom, request.identity?.sub));
  });

  /**
   * #250: set planned stop minutes for one or more checkpoints (Pace edit mode).
   *
   * Deliberately not `PUT /course`: that path fingerprints the whole course, so changing only a stop
   * duration would reset the crew task board, adaptive plan, and sync state. A planned stop changes
   * timing, not the course shape, so only the projection is recomputed here. All rows apply or none.
   */
  app.patch("/race-rooms/:roomId/checkpoint-stops", async (request, reply) => {
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await requireCourseEditor(app, request, reply, roomId);
    if (!room) {
      return;
    }

    const parsed = patchCheckpointStopsInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid planned stop payload" });
    }
    if (!room.course) {
      return reply.code(404).send({ error: "Course not found" });
    }

    const known = new Set(room.course.checkpoints.map((checkpoint) => checkpoint.id));
    const unknown = parsed.data.stops
      .map((stop) => stop.checkpointId)
      .filter((checkpointId) => !known.has(checkpointId));
    if (unknown.length > 0) {
      return reply.code(404).send({ error: "Checkpoint not found", checkpointIds: unknown });
    }

    await loadWs2RuntimeIfNeeded(roomId);
    const secondsById = new Map(parsed.data.stops.map((stop) => [stop.checkpointId, stop.plannedStopSeconds]));
    const updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
      if (!latest.course) {
        return latest;
      }
      const nextCheckpoints = latest.course.checkpoints.map((checkpoint) => {
        const plannedStopSeconds = secondsById.get(checkpoint.id);
        return plannedStopSeconds === undefined ? checkpoint : { ...checkpoint, plannedStopSeconds };
      });
      return syncWorkspaceCheckpoints(
        { ...latest, course: { ...latest.course, checkpoints: nextCheckpoints } },
        nextCheckpoints
      );
    });
    if (!updatedRoom?.course) {
      return reply.code(404).send({ error: "Course not found" });
    }
    await recomputeProjectionAfterCourseSave(app, roomId, updatedRoom);
    return reply.send(roomForViewer(updatedRoom, request.identity?.sub));
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
    return reply.send(roomForViewer(rebuilt.room, request.identity?.sub));
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

    let updatedRoom: RaceRoom | undefined;
    try {
      // Re-read under the lock. `room` was loaded before body parsing; saving it
      // whole drops a join that committed while this request was in flight.
      updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
        const next = applyRaceMapWorkspacePut(latest, parsed.data);
        // A used race keeps its route line; layer, label and checkpoint edits go through.
        if (isRaceLocked(latest, Date.now()) && routeLineSignature(next) !== routeLineSignature(latest)) {
          throw new RaceLockedError();
        }
        return next;
      });
    } catch (err) {
      if (err instanceof RaceLockedError) {
        return raceLockedReply(reply);
      }
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
    if (!updatedRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    // Workspace is already durable. Wipe dependents only after that save so a
    // failed save cannot destroy task boards while the prior workspace remains.

    await discardTaskBoardState(roomId);
    await discardWs2Runtime(roomId);
    const { discardWs4RoomState } = await import("./ws4AdaptivePlanRoutes.js");
    await discardWs4RoomState(roomId);
    const { discardWs5RoomState } = await import("./ws5SyncRoutes.js");
    await discardWs5RoomState(roomId);

    return reply.send(roomForViewer(updatedRoom, request.identity?.sub));
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

    // An invite grants its role on accept, so it must not be a way around the owner-only
    // role rules (PATCH /members). Only the race owner may invite above crew_member.
    if (room.athleteId !== request.identity.sub && parsed.data.role !== "crew_member") {
      return reply.code(403).send({ error: "Only the race owner can invite above crew_member" });
    }

    // An unpaid race takes no one new: that is the pass, not the upgrade. Every role is
    // refused, `athlete` included, since an invite names an email, not the runner's seat,
    // and an athlete-role invite accepted by someone else would be a free seat.
    const unpaid = roomUnpaidError(room);
    if (unpaid) {
      return reply.code(402).send(unpaid);
    }

    // Inviting crew past the room's tier is refused up front, so the runner sees the
    // upgrade prompt instead of the invitee hitting it on accept.
    if (parsed.data.role !== "athlete") {
      const limit = crewLimitError(room);
      if (limit) {
        return reply.code(409).send(limit);
      }
    }

    const issuedAt = Date.now();
    const requestedExpiry = parsed.data.expiresAt ? Date.parse(parsed.data.expiresAt) : undefined;
    if (
      requestedExpiry !== undefined &&
      (requestedExpiry <= issuedAt || requestedExpiry > issuedAt + INVITE_MAX_LIFETIME_MS)
    ) {
      return reply.code(400).send({ error: "Invite expiry must be in the future and within 7 days" });
    }

    const invite: RaceRoomInvite = {
      token: randomUUID(),
      roomId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      invitedBy: request.identity.sub,
      invitedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(requestedExpiry ?? issuedAt + INVITE_DEFAULT_LIFETIME_MS).toISOString(),
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

    // A fresh API process has no cached invites; pull this room's from storage.
    // Cached entries win, so a newer in-flight write is never overwritten.
    for (const persisted of await loadRaceRoomInvitesForRoom(roomId)) {
      rememberRaceRoomInviteIfAbsent(persisted);
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

    // The token is the capability to join as `role`. Only people who can issue
    // invites may read it back; every other member still sees status and email.
    const includeToken = getPermissions(membership.role).canIssueInvite;
    return reply.send({
      invites: invites.map((invite) => inviteForViewer(invite, includeToken))
    });
  });

  app.post("/race-rooms/:roomId/invites/accept", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const roomId = (request.params as { roomId: string }).roomId;
    const userId = request.identity.sub;
    // Two accepts (or an accept and a join) must not both build on the same member list.
    return await withRoomRuntimeLock(roomId, async () => {
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

      // Removed or demoted since issuing it: the invite lapses with their rights.
      if (!inviterStillAllowed(room, invite)) {
        await saveRaceRoomInvite({ ...invite, status: "expired" });
        return reply.code(410).send({ error: "Invite expired" });
      }

      const existing = room.memberships.find((member) => member.userId === userId);
      const removedAt = existing ? undefined : await roomRemovedAt(room.id, userId);
      if (!readmits(room, removedAt, invite)) {
        return reply.code(403).send({ error: "Ask the race owner for a new invite" });
      }
      // PATCH /members refuses to move the race athlete off `athlete`. Accepting a
      // link the athlete just created must not take that role away either, and must
      // leave the invite pending for the person it was meant for.
      if (
        existing &&
        existing.userId === room.athleteId &&
        existing.role === "athlete" &&
        invite.role !== "athlete"
      ) {
        return reply.code(409).send({ error: "Race owner role cannot be changed from athlete" });
      }
      // An invite issued while the race was paid is still refused once it is not, whatever
      // role it grants: on an unpaid race only the runner's own seat is taken or changed.
      if (!isRunnerSeat(room, userId)) {
        const unpaid = roomUnpaidError(room);
        if (unpaid) {
          return reply.code(402).send(unpaid);
        }
      }
      const becomesCrew =
        isCrewMembership(room, { userId, role: invite.role }) &&
        !(existing && isCrewMembership(room, existing));
      if (becomesCrew) {
        // Checked under the room lock, so two accepts at once cannot both take the last seat.
        const limit = crewLimitError(room);
        if (limit) {
          return reply.code(409).send(limit);
        }
      }
      const nextMemberships = existing
        ? room.memberships.map((member) =>
            member.userId === userId ? { ...member, role: invite.role } : member
          )
        : [
            ...room.memberships,
            {
              userId: userId,
              role: invite.role,
              joinedAt: new Date().toISOString()
            }
          ];

      const updatedRoom: RaceRoom = {
        ...room,
        memberships: nextMemberships
      };

      await saveRaceRoom(updatedRoom);
      if (removedAt !== undefined) {
        await clearRoomRemoval(room.id, userId);
      }
      await saveRaceRoomInvite({
        ...invite,
        status: "accepted",
        acceptedBy: userId,
        acceptedAt: new Date().toISOString()
      });

      const membership = updatedRoom.memberships.find((member) => member.userId === userId);
      if (!membership) {
        return reply.code(500).send({ error: "Membership assignment failed" });
      }

      return reply.send({
        room: roomForViewer(updatedRoom, userId),
        assignedRole: membership.role,
        permissions: getPermissions(membership.role)
      });
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

    const resolved = await getRaceRoom(parsed.data.roomCode);
    if (!resolved) {
      return reply.code(404).send({ error: "Race room not found" });
    }

    const userId = request.identity.sub;
    // Two crew joining at once must not both append to the same member list.
    return await withRoomRuntimeLock(resolved.id, async () => {
      const room = (await getRaceRoom(resolved.id)) ?? resolved;
      const writeDelay = membershipWriteDelayForTests;
      if (writeDelay) {
        membershipWriteDelayForTests = undefined;
        await writeDelay();
      }
      const existingMembership = room.memberships.find((member) => member.userId === userId);
      // Same answer as an unknown code, so the code stays a plain "not found" to the client.
      if (!existingMembership && !readmits(room, await roomRemovedAt(room.id, userId))) {
        return reply.code(404).send({ error: "Race room not found" });
      }
      if (!existingMembership && !isRunnerSeat(room, userId)) {
        // Crew may join before the runner pays (they wait on the locked race; GET answers 402
        // until it is unlocked). An unpaid race holds only the base crew cap, so joining early
        // never yields seats the runner didn't buy: existing members stay through any tier.
        // Under the room lock: of two crew joining at once, only one can take the last seat.
        const limit = crewLimitError(room);
        if (limit) {
          return reply.code(409).send(limit);
        }
      }
      const nextMemberships = existingMembership
        ? room.memberships
        : [
            ...room.memberships,
            {
              userId: userId,
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
      }

      const assignedMembership = updatedRoom.memberships.find((member) => member.userId === userId);
      if (!assignedMembership) {
        return reply.code(500).send({ error: "Membership assignment failed" });
      }

      // An existing member rejoining an unpaid race gets the room shaped for them, never the plan.
      return reply.send({
        room: roomForViewer(updatedRoom, userId),
        assignedRole: assignedMembership.role,
        permissions: getPermissions(assignedMembership.role)
      });
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
      let memberMissing = false;
      const updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
        if (!latest.memberships.some((member) => member.userId === memberUserId)) {
          memberMissing = true;
          return latest;
        }
        let next: RaceRoom = {
          ...latest,
          memberships: latest.memberships.map((member) =>
            member.userId === memberUserId ? { ...member, displayName: trimmed } : member
          )
        };
        if (memberUserId === latest.athleteId) {
          next = { ...next, creatorName: trimmed };
        }
        return next;
      });
      if (!updatedRoom) {
        return reply.code(404).send({ error: "Race room not found" });
      }
      if (memberMissing) {
        return reply.code(404).send({ error: "Member not found" });
      }
      const updatedMembership = updatedRoom.memberships.find((member) => member.userId === memberUserId);
      if (!updatedMembership) {
        return reply.code(500).send({ error: "Could not update display name" });
      }
      return reply.send({ room: roomForViewer(updatedRoom, request.identity.sub), membership: updatedMembership });
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

    let memberMissing = false;
    let ownerRoleBlocked = false;
    const updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
      const liveTarget = latest.memberships.find((member) => member.userId === memberUserId);
      if (!liveTarget) {
        memberMissing = true;
        return latest;
      }
      if (liveTarget.userId === latest.athleteId && parsed.data.role !== "athlete") {
        ownerRoleBlocked = true;
        return latest;
      }
      return {
        ...latest,
        memberships: latest.memberships.map((member) =>
          member.userId === memberUserId ? { ...member, role: parsed.data.role } : member
        )
      };
    });
    if (!updatedRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (memberMissing) {
      return reply.code(404).send({ error: "Member not found" });
    }
    if (ownerRoleBlocked) {
      return reply.code(409).send({ error: "Race owner role cannot be changed from athlete" });
    }
    const updatedMembership = updatedRoom.memberships.find((member) => member.userId === memberUserId);
    if (!updatedMembership) {
      return reply.code(500).send({ error: "Could not update member role" });
    }
    return reply.send({ room: roomForViewer(updatedRoom, request.identity.sub), membership: updatedMembership });
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

    // Recorded before the membership goes, so a failed write never leaves them out but able to rejoin.
    await recordRoomRemoval(room.id, memberUserId, new Date().toISOString());

    let memberMissing = false;
    let ownerRemovalBlocked = false;
    const updatedRoom = await commitRaceRoomUpdate(roomId, (latest) => {
      if (!latest.memberships.some((member) => member.userId === memberUserId)) {
        memberMissing = true;
        return latest;
      }
      if (memberUserId === latest.athleteId) {
        ownerRemovalBlocked = true;
        return latest;
      }
      return {
        ...latest,
        memberships: latest.memberships.filter((member) => member.userId !== memberUserId)
      };
    });
    if (!updatedRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (ownerRemovalBlocked) {
      return reply.code(409).send({ error: "Race owner cannot be removed from room" });
    }
    if (memberMissing) {
      return reply.code(404).send({ error: "Member not found" });
    }
    // Wakes the removed member's open chat long-poll, which then answers 403.
    publishChatRoom(roomId, "membership");
    return reply.send({ room: roomForViewer(updatedRoom, request.identity.sub) });
  });

  /**
   * The owner deletes the race for the whole crew. Same full delete as account deletion and the
   * unpaid sweeper (lib/raceRoomDeletion.ts), so every room URL answers 404 afterwards.
   */
  app.delete("/race-rooms/:roomId", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { roomId } = request.params as { roomId: string };
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (room.athleteId !== request.identity.sub) {
      return reply.code(403).send({ error: "Only the race owner can delete the race" });
    }

    // Dynamic import: lib/raceRoomDeletion.ts imports this module.
    const { deleteRaceRoomAndData } = await import("../lib/raceRoomDeletion.js");
    await deleteRaceRoomAndData(roomId);
    // Wakes the crew's open chat long-polls, which then find no room.
    publishChatRoom(roomId, "membership");
    return reply.send({ deleted: true });
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

    const viewer = request.identity.sub;
    const rooms = await listRaceRoomsByTeamId(teamId);
    const visibleRooms = rooms
      .filter((room) => room.memberships.some((member) => member.userId === viewer))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return reply.send({ rooms: visibleRooms.map((room) => roomForViewer(room, viewer)) });
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

    // Rooms are paid through store purchases (POST /billing/revenuecat) or the admin comp.
    // Setting it by hand stays for local dev, tests, and a staging opt-in only.
    if (!isManualBillingAllowed()) {
      return reply.code(403).send({ error: "Manual entitlement is disabled" });
    }

    const parsed = updateEntitlementInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid entitlement payload" });
    }

    const updated = await commitRaceRoomUpdate(roomId, (latest) => ({
      ...latest,
      entitlement: {
        status: parsed.data.status,
        lastUpdatedAt: new Date().toISOString(),
        source: "manual",
        crewTier: parsed.data.crewTier ?? "unlimited"
      }
    }));
    if (!updated) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    return reply.send(updated.entitlement);
  });

  type ProjectionSample = { pingId: string; latitude: number; longitude: number; recordedAtMs: number };

  /**
   * Fold accepted samples (oldest first) into the room projection. Checkpoint visits, stops and
   * progress advance per sample; the live remaining-course pass runs once, for the newest sample.
   * Only race samples fold in: one recorded before the race start (`isPreStartPing`) is stored by
   * the caller but skipped here, and a pre-start `previousAccepted` is no previous ping, so the
   * race's first ping starts from the pre-race projection. Caller holds the room runtime lock.
   * Returns undefined when the room cannot project or no sample is a race sample (the stored
   * projection is then untouched).
   */
  async function recomputeProjectionForSamples(
    room: RaceRoom,
    allSamples: ProjectionSample[],
    previousAccepted: AcceptedPing | null,
    lastUploadIntervalSeconds: number | undefined
  ): Promise<RaceRoomProjection | undefined> {
    const roomId = room.id;
    const raceAnchor = resolveRaceAnchorIso(room);
    const samples = allSamples.filter((sample) => !isPreStartPing(room, sample.recordedAtMs));
    const racePrevious =
      previousAccepted && !isPreStartPing(room, previousAccepted.recordedAtMs) ? previousAccepted : null;
    if (samples.length === 0 || !room.course || room.plannedPaceSecondsPerKm === undefined || !raceAnchor) {
      return undefined;
    }
    const routeMetricPoints = resolveRouteMetricPointsFromRaceRoom(room);
    if (!routeMetricPoints) {
      roomProjectionState.delete(roomId);
      app.log.warn({ roomId }, "projection_skipped_missing_route_layer");
      return undefined;
    }
    // The race's first ping starts from the pre-race projection. One a ping drove while every
    // accepted ping is pre-start was driven by pre-start pings (stored before they were ignored):
    // re-seed it, keeping only the crew's check-ins.
    const stored = roomProjectionState.get(roomId);
    if (previousAccepted && !racePrevious && stored && stored.lastProjectionCore.asOfPingId !== BOOTSTRAP_PING_ID) {
      await reseedPreRaceProjection(roomId, room);
    }
    const prev = roomProjectionState.get(roomId);
    let snapshot: ProjectionPreviousState | null = prev
      ? {
          lastProgressMeters: prev.lastProgressMeters,
          splitCrossedAt: { ...prev.splitCrossedAt },
          visitStates: structuredClone(prev.visitStates),
          visitMeta: structuredClone(prev.visitMeta),
          rollingMovingSpeedMps: prev.rollingMovingSpeedMps,
          ...(prev.liveRatio ? { liveRatio: { ...prev.liveRatio } } : {})
        }
      : null;
    const commitDelay = pingProjectionCommitDelayForTests;
    if (commitDelay?.roomId === roomId) {
      pingProjectionCommitDelayForTests = undefined;
      await commitDelay.delay();
    }
    try {
      let previousPing = racePrevious
        ? {
            pingId: racePrevious.pingId,
            latitude: racePrevious.latitude,
            longitude: racePrevious.longitude,
            recordedAt: new Date(racePrevious.recordedAtMs).toISOString()
          }
        : null;
      let core: RaceRoomProjectionCore | undefined;
      for (const sample of samples) {
        const ping = {
          pingId: sample.pingId,
          latitude: sample.latitude,
          longitude: sample.longitude,
          recordedAt: new Date(sample.recordedAtMs).toISOString()
        };
        const next = recomputeRaceProjection({
          roomId,
          activatedAt: raceAnchor,
          course: room.course,
          plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm,
          ping,
          previousPing,
          previous: snapshot,
          routeMetricPoints,
          canonicalCourseLengthMeters: room.courseDistanceMeters
        });
        core = next.projection;
        snapshot = next.state;
        previousPing = ping;
      }
      if (!core || !snapshot) {
        return undefined;
      }
      let enrichedCore = enrichProjectionWithLiveRemaining(core, room, routeMetricPoints, raceAnchor);
      if (isProjectionTunedConstantsEnabled()) {
        // Course history: average the live ETAs with what similar past finishers did from here.
        const cohort = await cohortForCourse(room.course, room.courseHistoryEventIds).catch(() => null);
        if (cohort) enrichedCore = blendWithCohort(enrichedCore, cohort, Date.parse(raceAnchor));
      }
      const newest = samples[samples.length - 1]!;
      if (justFinished(prev?.splitCrossedAt, enrichedCore, room.course)) {
        // First crossing of the finish: keep what this race says about the plan, stops and slowdown.
        try {
          const effort = buildFinishedEffort({
            roomId,
            athleteUserId: room.athleteId,
            course: room.course,
            core: enrichedCore,
            routeMetricPoints,
            raceAnchorIso: raceAnchor,
            plannedPaceSecondsPerKm: room.plannedPaceSecondsPerKm
          });
          if (effort) {
            await recordFinishedEffort(effort);
            await recordCrewCueCourseHistory(room, routeMetricPoints, raceAnchor);
            app.log.info({ finished_effort: { roomId, planLogError: effort.planLogError, slowdownSlope: effort.slowdownSlope } }, "finished_effort_recorded");
          }
        } catch (err) {
          app.log.warn({ err, roomId }, "finished_effort_failed");
        }
      }
      const projection = attachProjectionTimeliness(
        enrichedCore,
        newest.recordedAtMs,
        Date.now(),
        lastUploadIntervalSeconds
      );
      roomProjectionState.set(roomId, {
        lastProgressMeters: snapshot.lastProgressMeters,
        splitCrossedAt: { ...snapshot.splitCrossedAt },
        visitStates: structuredClone(snapshot.visitStates),
        visitMeta: structuredClone(snapshot.visitMeta),
        rollingMovingSpeedMps: snapshot.rollingMovingSpeedMps,
        ...(snapshot.liveRatio ? { liveRatio: { ...snapshot.liveRatio } } : {}),
        lastProjectionCore: enrichedCore
      });
      app.log.info(
        {
          projection_recompute: {
            roomId,
            pingId: newest.pingId,
            samples: samples.length,
            progressMeters: enrichedCore.progressMeters,
            courseLengthMeters: enrichedCore.courseLengthMeters
          }
        },
        "projection_recompute"
      );
      return projection;
    } catch (err) {
      app.log.warn({ err, roomId }, "projection_recompute_failed");
      return undefined;
    }
  }

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

    // Athlete location is authoritative for projection; only the race athlete may ingest pings.
    if (request.identity.sub !== room.athleteId) {
      return reply.code(403).send({ error: "Only the race athlete can ingest location pings" });
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

    const actorUserId = request.identity.sub;
    const beforeLock = pingBeforeLockDelayForTests;
    if (beforeLock?.roomId === roomId) {
      pingBeforeLockDelayForTests = undefined;
      await beforeLock.delay();
    }
    return await withRoomRuntimeLock(roomId, async () => {
    // `room` was read before this ping queued. A course or status write that committed meanwhile
    // must decide the projection, so re-read under the lock.
    const latestRoom = await getRaceRoom(roomId);
    if (!latestRoom) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (latestRoom.athleteId !== actorUserId) {
      return reply.code(403).send({ error: "Only the race athlete can ingest location pings" });
    }
    if (latestRoom.status !== "active") {
      return await reject("room_not_active", "Race room must be active to ingest pings");
    }
    const pingState = getOrInitPingState(roomId);
    if (pingState.lastAccepted && recordedAtMs <= pingState.lastAccepted.recordedAtMs) {
      // Progress only moves forward. A replay or an out-of-order sample would rewind the readouts.
      // A race ping is always after a pre-start one, so a test ping never makes it stale.
      return await reject("stale_recorded_at", "recordedAt must be after the last accepted ping");
    }
    // Speed is judged against the last race ping only. A pre-start (test) ping may be from home,
    // days or hours before: judged against it, the race's first ping could read as a drive.
    const speedReference = lastRacePing(pingState, latestRoom);
    if (speedReference) {
      const dtSec = (recordedAtMs - speedReference.recordedAtMs) / 1000;
      if (dtSec > 0) {
        const dist = distanceMeters(
          speedReference.latitude,
          speedReference.longitude,
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
    // The declared interval sets the projection's staleness threshold, so a pre-start ping does
    // not adopt it: a test ping leaves every freshness field as it was.
    if (body.uploadIntervalSeconds !== undefined && !isPreStartPing(latestRoom, recordedAtMs)) {
      pingState.lastUploadIntervalSeconds = body.uploadIntervalSeconds;
    }

    const acceptedEntry: AthletePingHistoryEntry = {
      id: randomUUID(),
      at: receivedAt,
      actor: actorUserId,
      decision: "accepted",
      pingId
    };
    await pushPingHistory(roomId, acceptedEntry);

    app.log.info(
      { ping_decision: { roomId, actor: actorUserId, decision: "accepted", pingId } },
      "ping_decision"
    );

    await appendTrackPoints(roomId, [
      {
        recordedAtMs,
        latitude: body.latitude,
        longitude: body.longitude,
        ...(body.horizontalAccuracyMeters !== undefined ? { accuracyMeters: body.horizontalAccuracyMeters } : {}),
        receivedAtMs,
        pingId
      }
    ]);

    const projection = await recomputeProjectionForSamples(
      latestRoom,
      [{ pingId, latitude: body.latitude, longitude: body.longitude, recordedAtMs }],
      previousAccepted,
      pingState.lastUploadIntervalSeconds
    );

    await saveWs2RuntimeSnapshot(roomId);
    await lockRaceAtFirstAid(request.log, latestRoom);

    // Pings to an unpaid race are 402 above; were that gate opened, the reply is still the teaser,
    // whose finish is from the start line, not from this ping's position.
    const shown = projection ? projectionForRoom(projection, latestRoom, teaserLockLengthMeters(latestRoom)) : undefined;
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
      ...(shown ? { projection: shown } : {})
    });
    });
  });

  /**
   * Backlog upload: every sample the athlete phone buffered while it had no service, in one request.
   * Same gates as the single ping. Points are judged oldest first; each one is accepted, a
   * `duplicate` of a stored sample (a replayed upload, treated as success), or rejected. Unlike the
   * single ping, samples may be old: only the future side of the clock-skew window applies, back
   * to `backlogFloorMs`.
   */
  app.post("/race-rooms/:roomId/pings/batch", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (!room.memberships.some((member) => member.userId === request.identity?.sub)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    if (request.identity.sub !== room.athleteId) {
      return reply.code(403).send({ error: "Only the race athlete can ingest location pings" });
    }
    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    await loadWs2RuntimeIfNeeded(roomId);

    const parsed = ingestAthletePingBatchInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ping batch payload" });
    }
    const body = parsed.data;
    const receivedAt = new Date().toISOString();
    const receivedAtMs = Date.parse(receivedAt);
    const actorUserId = request.identity.sub;

    if (room.status !== "active") {
      await pushPingHistory(roomId, {
        id: randomUUID(),
        at: receivedAt,
        actor: actorUserId,
        decision: "rejected",
        reason: "room_not_active"
      });
      return reply.code(422).send({
        decision: "rejected" as const,
        reason: "room_not_active" as const,
        message: "Race room must be active to ingest pings"
      });
    }

    const anchorIso = resolveRaceAnchorIso(room);
    const anchorMs = anchorIso ? Date.parse(anchorIso) : Number.NaN;
    const floorMs = backlogFloorMs(receivedAtMs, Number.isNaN(anchorMs) ? undefined : anchorMs);
    const points = body.points.map((point, index) => ({ ...point, index, recordedAtMs: Date.parse(point.recordedAt) }));
    const ordered = [...points].sort((a, b) => a.recordedAtMs - b.recordedAtMs || a.index - b.index);

    const beforeLock = pingBeforeLockDelayForTests;
    if (beforeLock?.roomId === roomId) {
      pingBeforeLockDelayForTests = undefined;
      await beforeLock.delay();
    }
    return await withRoomRuntimeLock(roomId, async () => {
      // As in the single ping: `room` was read before this upload queued, so re-read under the lock.
      const latestRoom = await getRaceRoom(roomId);
      if (!latestRoom) {
        return reply.code(404).send({ error: "Race room not found" });
      }
      if (latestRoom.athleteId !== actorUserId) {
        return reply.code(403).send({ error: "Only the race athlete can ingest location pings" });
      }
      if (latestRoom.status !== "active") {
        return reply.code(422).send({
          decision: "rejected" as const,
          reason: "room_not_active" as const,
          message: "Race room must be active to ingest pings"
        });
      }
      const pingState = getOrInitPingState(roomId);
      const previousAccepted = pingState.lastAccepted;
      const stored = previousAccepted
        ? await existingTrackTimes(
            roomId,
            ordered.filter((p) => p.recordedAtMs <= previousAccepted.recordedAtMs).map((p) => p.recordedAtMs)
          )
        : new Set<number>();
      if (previousAccepted) {
        stored.add(previousAccepted.recordedAtMs);
      }

      const results: AthletePingBatchPointResult[] = new Array(points.length);
      const accepted: Array<ProjectionSample & { accuracyMeters?: number }> = [];
      let last = previousAccepted;
      for (const point of ordered) {
        const decide = (decision: AthletePingBatchPointResult["decision"], reason?: AthletePingRejectReason, pingId?: string) => {
          results[point.index] = {
            recordedAt: point.recordedAt,
            decision,
            ...(reason ? { reason } : {}),
            ...(pingId ? { pingId } : {})
          };
        };
        if (point.horizontalAccuracyMeters !== undefined && point.horizontalAccuracyMeters > MAX_HORIZONTAL_ACCURACY_M) {
          decide("rejected", "accuracy_too_poor");
          continue;
        }
        if (point.recordedAtMs > receivedAtMs + MAX_CLOCK_SKEW_MS || point.recordedAtMs < floorMs) {
          decide("rejected", "clock_skew");
          continue;
        }
        if (last && point.recordedAtMs <= last.recordedAtMs) {
          if (stored.has(point.recordedAtMs)) {
            decide("duplicate");
          } else {
            decide("rejected", "stale_recorded_at");
          }
          continue;
        }
        // As in the single ping: speed is judged against the last race sample only, never a
        // pre-start (test) one.
        if (last && !isPreStartPing(latestRoom, last.recordedAtMs)) {
          const dtSec = (point.recordedAtMs - last.recordedAtMs) / 1000;
          const dist = distanceMeters(last.latitude, last.longitude, point.latitude, point.longitude);
          if (dist / dtSec > MAX_SPEED_MPS) {
            decide("rejected", "implausible_motion");
            continue;
          }
        }
        const pingId = randomUUID();
        last = {
          pingId,
          latitude: point.latitude,
          longitude: point.longitude,
          recordedAtMs: point.recordedAtMs,
          receivedAtMs
        };
        stored.add(point.recordedAtMs);
        accepted.push({
          pingId,
          latitude: point.latitude,
          longitude: point.longitude,
          recordedAtMs: point.recordedAtMs,
          ...(point.horizontalAccuracyMeters !== undefined ? { accuracyMeters: point.horizontalAccuracyMeters } : {})
        });
        decide("accepted", undefined, pingId);
      }

      pingState.lastAccepted = last;
      // As in the single ping: not adopted while the room's latest ping is pre-start.
      if (body.uploadIntervalSeconds !== undefined && !(last && isPreStartPing(latestRoom, last.recordedAtMs))) {
        pingState.lastUploadIntervalSeconds = body.uploadIntervalSeconds;
      }
      for (const result of results) {
        if (result.decision === "duplicate") {
          continue;
        }
        pingState.history.push({
          id: randomUUID(),
          at: receivedAt,
          actor: actorUserId,
          decision: result.decision,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.pingId ? { pingId: result.pingId } : {})
        });
      }
      if (pingState.history.length > PING_HISTORY_CAP) {
        pingState.history.splice(0, pingState.history.length - PING_HISTORY_CAP);
      }

      await appendTrackPoints(
        roomId,
        accepted.map((sample) => ({ ...sample, receivedAtMs }))
      );
      const projection = await recomputeProjectionForSamples(
        latestRoom,
        accepted,
        previousAccepted,
        pingState.lastUploadIntervalSeconds
      );
      await saveWs2RuntimeSnapshot(roomId);
      await lockRaceAtFirstAid(request.log, latestRoom);

      const counts = { accepted: 0, duplicate: 0, rejected: 0 };
      for (const result of results) {
        counts[result.decision] += 1;
      }
      app.log.info({ ping_batch_decision: { roomId, actor: actorUserId, ...counts } }, "ping_batch_decision");

      // As in the single ping: on an unpaid race (402 above today) the reply is the teaser.
      const shown = projection ? projectionForRoom(projection, latestRoom, teaserLockLengthMeters(latestRoom)) : undefined;
      const response: AthletePingBatchResponse = {
        roomId,
        receivedAt,
        results,
        acceptedCount: counts.accepted,
        ...(shown ? { projection: shown } : {})
      };
      return reply.code(200).send(response);
    });
  });

  /**
   * The athlete's path: accepted samples oldest first, paged by `after` (exclusive). Any member may
   * read it. Each page names the start its `preStart` marks were judged against (`raceStartAt`).
   */
  app.get("/race-rooms/:roomId/pings/track", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const roomId = (request.params as { roomId: string }).roomId;
    const room = await getRaceRoom(roomId);
    if (!room) {
      return reply.code(404).send({ error: "Race room not found" });
    }
    if (!room.memberships.some((member) => member.userId === request.identity?.sub)) {
      return reply.code(403).send({ error: "Forbidden" });
    }
    const entitlement = evaluateEntitlement(app, room, request.identity.sub);
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }
    const query = pingTrackQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "Invalid track query" });
    }
    const { after, limit } = query.data;
    const rows = await listTrackPoints(roomId, after ? Date.parse(after) : undefined, limit);
    const points = rows.map((row) => ({
      recordedAt: new Date(row.recordedAtMs).toISOString(),
      latitude: row.latitude,
      longitude: row.longitude,
      // Judged against the start as it is now, so moving the start re-marks the stored track.
      ...(isPreStartPing(room, row.recordedAtMs) ? { preStart: true as const } : {})
    }));
    const startMs = raceStartMs(room);
    const response: RaceRoomPingTrackResponse = {
      roomId,
      points,
      ...(points.length === limit ? { nextCursor: points[points.length - 1]!.recordedAt } : {}),
      // The start the marks above were judged against: a client holding points read under another
      // start reads the track again from the beginning (see the contract).
      ...(startMs !== undefined ? { raceStartAt: new Date(startMs).toISOString() } : {})
    };
    return reply.send(response);
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

    // Unpaid: the runner sees the finish ETA only (teaser); crew get 402.
    const entitlement = evaluateEntitlement(app, room, request.identity.sub, { allowUnpaidRunner: true });
    if (!entitlement.allowed) {
      return reply.code(entitlement.code ?? 403).send({ error: entitlement.error });
    }

    await loadWs2RuntimeIfNeeded(roomId);
    await reseedStalePreStartProjectionOnRead(roomId, room, request.log);

    let stored = roomProjectionState.get(roomId);
    if (!stored) {
      await ensureBootstrapProjection(roomId, room, true);
      stored = roomProjectionState.get(roomId);
    }
    if (!stored) {
      return reply.code(404).send({ error: "Projection not available" });
    }

    const pingState = getOrInitPingState(roomId);
    // Fresh only after a race ping: a pre-start (test) ping never makes the projection fresh.
    const view = attachProjectionTimeliness(
      stored.lastProjectionCore,
      lastRacePing(pingState, room)?.recordedAtMs ?? null,
      Date.now(),
      pingState.lastUploadIntervalSeconds
    );
    // The teaser's finish is from the start line, wherever the projection places the runner
    // (see `teaserProjection`).
    return reply.send(entitlement.teaser ? teaserProjection(view, room, teaserLockLengthMeters(room)) : view);
  });

  /**
   * Closed manual check-in (arrival + departure). Feeds schedule reproject on GET /schedule:
   * closed visits replace planned stoppage + delayOverride for subsequent stop clocks
   * (absolute latest closed actual per CP — LWW overwrite, no double-apply). Incomplete/open
   * visits are not written here (both timestamps required); open auto visits also do not shift.
   */
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
    // Dynamic import avoids a static raceRooms ↔ raceRoomSchedule cycle.
    const { closedActualStopSecondsByCheckpointId } = await import("./raceRoomSchedule.js");
    const recordedByUserId = request.identity.sub;
    const applied = await withRoomRuntimeLock(roomId, async () => {
    await loadWs2RuntimeIfNeeded(roomId);
    const projectionState = roomProjectionState.get(roomId);
    const raceAnchor = resolveRaceAnchorIso(room);
    if (!projectionState || !raceAnchor) {
      return { ok: false as const, code: 409 as const, error: "Projection state unavailable" };
    }
    const split = projectionState.lastProjectionCore.checkpointSplits.find((row) => row.checkpointId === checkpointId);
    if (!split) {
      return { ok: false as const, code: 404 as const, error: "Checkpoint not found on room course" };
    }
    const arrivalMs = Date.parse(parsed.data.arrivalAt);
    const departureMs = Date.parse(parsed.data.departureAt);
    if (!Number.isFinite(arrivalMs) || !Number.isFinite(departureMs) || departureMs <= arrivalMs) {
      return { ok: false as const, code: 400 as const, error: "departureAt must be after arrivalAt" };
    }
    const beforeClosedActualByCheckpointId = closedActualStopSecondsByCheckpointId(
      projectionState.lastProjectionCore.checkpointSplits
    );
    const manualEntry: CheckpointVisitManualData = {
      arrivalAt: parsed.data.arrivalAt,
      departureAt: parsed.data.departureAt,
      actualStopSeconds: (departureMs - arrivalMs) / 1000,
      recordedByUserId
    };
    const overlapAutoVisit =
      split.visits.find(
        (visit) =>
          visit.autoDetected?.arrivalRecordedAt &&
          Date.parse(visit.autoDetected.arrivalRecordedAt) <= departureMs &&
          (visit.autoDetected.departureRecordedAt
            ? Date.parse(visit.autoDetected.departureRecordedAt)
            : Number.POSITIVE_INFINITY) >= arrivalMs
      ) ?? null;
    // Last-write-wins for schedule ETAs: prefer existing manual_crew, else overlapping auto,
    // else latest closed visit (avoid appending beside a prior closed auto → double actual).
    const existingManualVisit =
      [...split.visits].reverse().find((visit) => visit.resolvedSource === "manual_crew" && visit.manualEntry) ??
      null;
    const latestClosedVisit =
      [...split.visits]
        .reverse()
        .find(
          (visit) =>
            visit.activeActualStopSeconds !== null &&
            visit.activeActualStopSeconds !== undefined &&
            Number.isFinite(visit.activeActualStopSeconds)
        ) ?? null;
    const targetVisit = existingManualVisit ?? overlapAutoVisit ?? latestClosedVisit;
    if (targetVisit) {
      targetVisit.manualEntry = manualEntry;
      if (parsed.data.note) {
        targetVisit.note = parsed.data.note;
      }
      targetVisit.resolvedSource = "manual_crew";
    } else {
      split.visits.push({
        visitIndex: nextVisitIndex(split.visits),
        resolvedSource: "manual_crew",
        manualEntry,
        activeActualStopSeconds: null,
        ...(parsed.data.note ? { note: parsed.data.note } : {})
      });
    }
    refreshCheckpointSplitStoppageDerivedFields(split);
    recomputeProjectionStoppageSummary(projectionState.lastProjectionCore, raceAnchor);
    {
      const routeForLive = resolveRouteMetricPointsFromRaceRoom(room);
      if (routeForLive) {
        projectionState.lastProjectionCore = enrichProjectionWithLiveRemaining(
          projectionState.lastProjectionCore,
          room,
          routeForLive,
          raceAnchor
        );
      }
    }
    syncProjectionAccumulatorStateFromCore(projectionState);
      await saveWs2RuntimeSnapshot(roomId);
      const afterClosedActualByCheckpointId = closedActualStopSecondsByCheckpointId(
        projectionState.lastProjectionCore.checkpointSplits
      );
      return {
        ok: true as const,
        split,
        beforeClosedActualByCheckpointId,
        afterClosedActualByCheckpointId
      };
    });
    if (!applied.ok) {
      return reply.code(applied.code).send({ error: applied.error });
    }
      // W2-2: material later-ETA shift → push notify (prefs + exclude actor). Never fail the write.
      try {
        await notifyEntitledMembersOfCheckInEtaShift({
          room,
          actorUserId: request.identity.sub,
          checkpointId,
          beforeClosedActualByCheckpointId: applied.beforeClosedActualByCheckpointId,
          afterClosedActualByCheckpointId: applied.afterClosedActualByCheckpointId,
          log: request.log
        });
      } catch (err) {
        request.log.warn({ err, roomId, checkpointId }, "check_in_eta_notify_unexpected_error");
      }
      const manualStopPayload = { checkpointSplit: applied.split };
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
    const applied = await withRoomRuntimeLock(roomId, async () => {
      await loadWs2RuntimeIfNeeded(roomId);
      const projectionState = roomProjectionState.get(roomId);
      const raceAnchor = resolveRaceAnchorIso(room);
      if (!projectionState || !raceAnchor) {
        return { ok: false as const, code: 409 as const, error: "Projection state unavailable" };
      }
      const split = projectionState.lastProjectionCore.checkpointSplits.find((row) => row.checkpointId === checkpointId);
      if (!split) {
        return { ok: false as const, code: 404 as const, error: "Checkpoint not found on room course" };
      }
      const visit = split.visits.find((v) => v.visitIndex === visitIndex);
      if (!visit) {
        return { ok: false as const, code: 404 as const, error: "Visit not found" };
      }
      if (parsed.data.resolvedSource === "manual_crew" && !visit.manualEntry) {
        return { ok: false as const, code: 400 as const, error: "manual_crew requires manualEntry on the visit" };
      }
      if (parsed.data.resolvedSource === "auto" && !visit.autoDetected) {
        return { ok: false as const, code: 400 as const, error: "auto requires autoDetected on the visit" };
      }
      visit.resolvedSource = parsed.data.resolvedSource;
      refreshCheckpointSplitStoppageDerivedFields(split);
      recomputeProjectionStoppageSummary(projectionState.lastProjectionCore, raceAnchor);
      {
        const routeForLive = resolveRouteMetricPointsFromRaceRoom(room);
        if (routeForLive) {
          projectionState.lastProjectionCore = enrichProjectionWithLiveRemaining(
            projectionState.lastProjectionCore,
            room,
            routeForLive,
            raceAnchor
          );
        }
      }
      syncProjectionAccumulatorStateFromCore(projectionState);
      await saveWs2RuntimeSnapshot(roomId);
      return { ok: true as const, split };
    });
    if (!applied.ok) {
      return reply.code(applied.code).send({ error: applied.error });
    }
    return reply.send({ checkpointSplit: applied.split });
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

  /**
   * Latest accepted athlete ping. Crew phones drive race progress readouts from this, never from
   * their own GPS, so every member sees the same mile, ETA, and "last ping". A ping recorded
   * before the race start is marked `preStart: true`: it shows the runner's dot, and nothing else
   * moved with it. Its `progressMeters` is 0, the race not begun: a client that finds no
   * `progressMeters` snaps the ping to the nearest checkpoint, so a test ping at the finish lot
   * would read as a finished race on every crew phone.
   */
  app.get("/race-rooms/:roomId/pings/latest", async (request, reply) => {
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

    const state = getOrInitPingState(roomId);
    const body: RaceRoomLatestPingResponse = {
      roomId,
      stalenessThresholdSeconds: getStalenessThresholdSeconds(state.lastUploadIntervalSeconds),
      evaluatedAt: new Date().toISOString()
    };
    const last = state.lastAccepted;
    if (last) {
      const core = roomProjectionState.get(roomId)?.lastProjectionCore;
      const preStart = isPreStartPing(room, last.recordedAtMs);
      body.ping = {
        pingId: last.pingId,
        latitude: last.latitude,
        longitude: last.longitude,
        recordedAt: new Date(last.recordedAtMs).toISOString(),
        receivedAt: new Date(last.receivedAtMs).toISOString(),
        ...(preStart
          ? { progressMeters: 0, preStart: true as const }
          : core && core.asOfPingId === last.pingId && Number.isFinite(core.progressMeters)
            ? { progressMeters: core.progressMeters }
            : {})
      };
    }
    return reply.send(body);
  });
}
