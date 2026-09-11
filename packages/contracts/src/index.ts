import type { PacingEstimate, RaceRoomStopPlan, WaypointTag } from "./pacingSchedule.js";

export type Role = "athlete" | "crew_member" | "crew_chief" | "team_manager";

export interface IdentityClaims {
  sub: string;
  email?: string;
  teamIds: string[];
  roomRoles: Record<string, Role>;
}

export interface DomainEvent<TPayload = unknown> {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  occurredAt: string;
  version: number;
  idempotencyKey: string;
  payload: TPayload;
}

export interface HealthStatus {
  service: string;
  status: "ok" | "degraded" | "down";
  timestamp: string;
}

export type RaceRoomStatus = "draft" | "active" | "completed";

export interface RaceRoomMembership {
  userId: string;
  role: Role;
  joinedAt: string;
  /** Roster display name chosen by this member; shown to the whole room when set. */
  displayName?: string;
}

/**
 * Optional per-checkpoint cutoff. Persisted shape supports both entry modes in the Pace UI.
 * - `time_of_day`: wall-clock cutoff (hour/minute in local race-day interpretation).
 * - `elapsed_from_start`: seconds from race activation (`room.activatedAt`) anchor.
 */
export type RaceCourseCheckpointCutoff =
  | { mode: "time_of_day"; hour: number; minute: number }
  | { mode: "elapsed_from_start"; seconds: number };

/** Ordered polyline for WS2 projection (geodesic math in API; legacy docs may mention local XY). */
export interface RaceCourseCheckpoint {
  id: string;
  /** Human-readable station label (separate from stable `id` slug). */
  title?: string;
  latitude: number;
  longitude: number;
  /** Arc length along the canonical route polyline when known (server-computed on course save). */
  distanceMetersFromStart?: number;
  plannedStopSeconds?: number;
  stoppageRadiusMeters?: number;
  slowdownThresholdRatio?: number;
  /** Parsed from course file description or set manually in Pace edit mode. */
  cutoff?: RaceCourseCheckpointCutoff;
  /**
   * Operational tags (aid / water / dropbag / crew). Omit or `[]` for an untagged landmark.
   * Additive: older payloads without `tags` remain valid.
   */
  tags?: WaypointTag[];
}

/** Optional non-linear baseline profile used for WS2 planned split / ETA projections. */
export interface RaceCourseBaselinePoint {
  distanceMetersFromStart: number;
  referenceElapsedSeconds: number;
  /** Sampled elevation (meters) at this baseline sample when available. */
  elevationMeters?: number;
}

export interface RaceCourseBaselineTrack {
  points: RaceCourseBaselinePoint[];
}

/** Source for `elevationGainMeters` / `elevationLossMeters` on the canonical polyline. */
export type RaceCourseElevationSource = "gpx_smoothed" | "dem" | "none";

/** Server-derived stats so clients and projection share one definition of distance and climb. */
export interface RaceCourseDerivedMetrics {
  canonicalDistanceMeters: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  elevationSource: RaceCourseElevationSource;
  /** Bump when smoothing or geodesic algorithms change. */
  metricsVersion: number;
}

export interface RaceCourse {
  checkpoints: RaceCourseCheckpoint[];
  /** Optional high-density reference track; older clients can omit this and retain flat pace behavior. */
  baselineTrack?: RaceCourseBaselineTrack;
  /** Populated when course metrics are computed (e.g. on PUT course / map workspace sync). */
  derivedMetrics?: RaceCourseDerivedMetrics;
}

/** GeoJSON position [longitude, latitude] or [longitude, latitude, elevationMeters]. */
export type MapWorkspacePosition = [number, number] | [number, number, number];

export interface MapWorkspaceLineStringGeometry {
  type: "LineString";
  coordinates: MapWorkspacePosition[];
}

export interface MapWorkspaceMultiLineStringGeometry {
  type: "MultiLineString";
  coordinates: MapWorkspacePosition[][];
}

export type MapWorkspaceTrackGeometry =
  | MapWorkspaceLineStringGeometry
  | MapWorkspaceMultiLineStringGeometry;

/** Single uploaded track/route overlay for the interactive map workspace (display + optional projection driver). */
export interface MapWorkspaceLayer {
  id: string;
  label: string;
  visible: boolean;
  sourceFileName?: string;
  /** Stroke color hint for renderers, e.g. #3388ff */
  strokeColor?: string;
  geometry: MapWorkspaceTrackGeometry;
}

/**
 * Server-persisted map workspace per race room (multi-upload overlays + selection).
 * Operational checkpoints mirror `RaceCourse.checkpoints` when synchronized via PUT.
 */
export interface RaceMapWorkspace {
  layers: MapWorkspaceLayer[];
  selectedLayerId?: string;
  /** Overlay whose geometry may regenerate `RaceCourse.baselineTrack` when requested. */
  drivesProjectionLayerId?: string;
  checkpoints: RaceCourseCheckpoint[];
}

export type NavigationRoutingMode = "drive" | "hike";

export interface NavigationRouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
}

/** Normalized routing result (CrewCue API); mobile navigation UI consumes this shape. */
export interface NavigationRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: MapWorkspaceLineStringGeometry;
  steps: NavigationRouteStep[];
}

/** Optional routing UX hints computed server-side (Crow-flight vs routed distance, hike detour signals). */
export interface NavigationRouteMeta {
  /** routed path length / crow-flight distance between first and last routing coordinate */
  detourRatio: number;
  /** Best-effort hint when pedestrian routing is much longer than straight-line between endpoints */
  hikeRouteQuality?: "direct" | "possibly_indirect";
}

export interface PostNavigationRouteResponse {
  route: NavigationRouteResult;
  meta?: NavigationRouteMeta;
}

/** MapTiler geocode proxy result item (normalized for clients). */
export interface GeocodeSearchResultItem {
  label: string;
  longitude: number;
  latitude: number;
}

export interface RaceCheckpointSplitRow {
  checkpointId: string;
  distanceMetersFromStart: number;
  crossedAtRecordedAt: string | null;
  plannedElapsedSecondsAtCross: number;
  /** Planned wall-clock at this checkpoint crossing (`raceStartAt` + planned elapsed). Filled on projection reads when anchor exists. */
  plannedAidStationClockIso?: string;
  actualElapsedSecondsAtCross: number | null;
  deltaSecondsAtCross: number | null;
  plannedStopSeconds: number;
  visits: CheckpointVisit[];
  totalActualStopSeconds: number | null;
  deltaStopSeconds: number | null;
}

export type CheckpointVisitSource = "auto" | "manual_crew";

export interface CheckpointVisitAutoData {
  arrivalRecordedAt: string | null;
  departureRecordedAt: string | null;
  firstSlowedAt: string | null;
  actualStopSeconds: number | null;
}

export interface CheckpointVisitManualData {
  arrivalAt: string;
  departureAt: string;
  actualStopSeconds: number;
  recordedByUserId: string;
}

export interface CheckpointVisit {
  visitIndex: number;
  resolvedSource: CheckpointVisitSource;
  autoDetected?: CheckpointVisitAutoData;
  manualEntry?: CheckpointVisitManualData;
  activeActualStopSeconds: number | null;
  note?: string;
}

export interface CheckpointStoppageSummary {
  totalPlannedStopSeconds: number;
  totalActualStopSeconds: number;
  totalDeltaStopSeconds: number | null;
  stoppageTimePercent: number | null;
  remainingPlannedStopSeconds: number;
}

/**
 * MVP synthetic race-weather baseline on WS2 projection reads (not live provider data).
 * Future: replace `source: "stub"` with a provider-backed envelope while keeping the field optional for older clients.
 */
export interface ProjectionWeatherStub {
  source: "stub";
  summary: string;
  assumedHeadwindMps: number;
}

/**
 * Live remaining-course ETA for one checkpoint (additive; older clients ignore).
 * `deltaSecondsVsFrozenPlan` = liveProjectedElapsed − frozenPlanElapsed (+ = behind plan).
 */
export interface RemainingCheckpointEta {
  checkpointId: string;
  liveProjectedElapsedSeconds: number;
  frozenPlanElapsedSeconds: number;
  deltaSecondsVsFrozenPlan: number;
}

/** Deterministic split/ETA math from the last accepted ping (no wall-clock freshness in core). */
export interface RaceRoomProjectionCore {
  roomId: string;
  asOfPingId: string;
  asOfRecordedAt: string;
  progressMeters: number;
  courseLengthMeters: number;
  plannedPaceSecondsPerKm: number;
  etaFinishPlanIso: string;
  checkpointSplits: RaceCheckpointSplitRow[];
  stoppageSummary: CheckpointStoppageSummary;
  weatherStub?: ProjectionWeatherStub;
  /**
   * Remaining checkpoints re-simulated from current progress (expected scenario).
   * Compare to frozen plan-of-record moving times for ahead/behind.
   */
  remainingCheckpointEtas?: RemainingCheckpointEta[];
}

export type ProjectionConfidence = "fresh" | "degraded";

/** Wall-clock freshness for reads (WS2 Task 3); computed when the response is built. */
export interface ProjectionTimeliness {
  projectionConfidence: ProjectionConfidence;
  /**
   * Effective threshold: `min(PROJECTION_STALE_AFTER_SECONDS or 15m, 15m)` when no client interval is set,
   * or `min(3 × uploadIntervalSeconds, 15 minutes)` when `uploadIntervalSeconds` is declared on pings (capped at 15m).
   */
  stalenessThresholdSeconds: number;
  /** Seconds between last accepted ping `recordedAt` and when this payload was evaluated (≥ 0). */
  secondsSinceLastAcceptedPing: number;
  /** ISO time when timeliness fields were computed (server clock). */
  evaluatedAt: string;
}

export type RaceRoomProjection = RaceRoomProjectionCore & ProjectionTimeliness;

export interface RaceRoom {
  id: string;
  /** Human-friendly 6-digit join code (zero-padded). Distinct from internal `id`. */
  joinCode?: string;
  creatorName?: string;
  description?: string;
  crewName?: string;
  teamId: string;
  athleteId: string;
  name: string;
  status: RaceRoomStatus;
  createdAt: string;
  /** Official race clock anchor (ISO). Preferred over legacy `activatedAt` for new clients. */
  raceStartAt?: string;
  /** Legacy anchor for projection elapsed math; mirrors `raceStartAt` when set via course save. */
  activatedAt?: string;
  eventEndsAt?: string;
  memberships: RaceRoomMembership[];
  entitlement: RaceRoomEntitlement;
  /** Set when a course is saved; drives WS2 split / ETA projection. */
  course?: RaceCourse;
  /** Persisted at upload time for fast UI reads without recomputation. */
  courseDistanceMeters?: number;
  /** Persisted at upload time for fast UI reads without recomputation. */
  courseElevationGainMeters?: number;
  /** When derived metrics include loss (smoothed GPX profile). */
  courseElevationLossMeters?: number;
  /** Original uploaded filename for route metadata display. */
  courseFileName?: string;
  /** Raw course GPX XML when uploaded (reprocess / audit); parsed geometry remains authoritative for routing. */
  courseGpxXml?: string;
  /** Seconds per kilometre for plan baseline (smaller = faster plan). */
  plannedPaceSecondsPerKm?: number;
  /** Multi-upload map overlays + map-authored checkpoints (optional until clients populate). */
  mapWorkspace?: RaceMapWorkspace;
  /**
   * Plan-scoped per-stop notes and delay overrides. Note bodies live here, not on
   * `RaceCourseCheckpoint`. Keyed by `RaceRoomStopPlan.checkpointId`.
   */
  stopPlans?: RaceRoomStopPlan[];
  /**
   * Plan-of-record pacing estimate id (W3-4). When set with `pacingEstimate`,
   * GET /schedule uses estimate moving times as the baseline under stoppage/delay overlays.
   */
  pacingEstimateId?: string;
  /** Snapshot of the attached plan-of-record estimate (source of truth for schedule reads). */
  pacingEstimate?: PacingEstimate;
}

/** Anonymous-safe payload for join-by-code onboarding preview (GET /race-rooms/join-preview/:code). */
export interface RaceRoomJoinPreviewMember {
  displayName: string;
  role: Role;
}

/** Checkpoint markers suitable for a future map preview (no visit telemetry). */
export interface RaceRoomJoinPreviewCheckpoint {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
}

export interface RaceRoomJoinPreview {
  roomName: string;
  joinCode: string;
  status: RaceRoomStatus;
  memberCount: number;
  members: RaceRoomJoinPreviewMember[];
  courseDistanceMeters?: number;
  courseElevationGainMeters?: number;
  plannedPaceSecondsPerKm?: number;
  courseFileName?: string;
  /** Simplified route geometry for optional map UI during onboarding. */
  baselineTrack?: RaceCourseBaselineTrack;
  checkpoints?: RaceRoomJoinPreviewCheckpoint[];
}

export type RaceRoomEntitlementStatus = "unpaid" | "paid" | "expired";

export interface RaceRoomEntitlement {
  status: RaceRoomEntitlementStatus;
  lastUpdatedAt: string;
  source: "manual" | "provider_webhook";
}

export type RaceRoomInviteStatus = "pending" | "accepted" | "expired";

export interface RaceRoomInvite {
  token: string;
  roomId: string;
  email: string;
  role: Role;
  expiresAt: string;
  status: RaceRoomInviteStatus;
  invitedBy: string;
  invitedAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
}

/** WS2 Task 1 — client payload for athlete location ping ingest */
export interface AthletePingIngestPayload {
  latitude: number;
  longitude: number;
  recordedAt: string;
  horizontalAccuracyMeters?: number;
  /**
   * Target seconds between pings from the athlete app (battery + race-length policy).
   * When set, the server derives projection staleness threshold as `min(3 × this value, 15 minutes)`.
   * @see docs/sdlc/mobile-athlete-ping-battery-deferred.md
   */
  uploadIntervalSeconds?: number;
}

/** Business-rule rejections after auth, membership, and entitlement gates */
export type AthletePingRejectReason =
  | "room_not_active"
  | "clock_skew"
  | "implausible_motion"
  | "accuracy_too_poor";

export interface AthletePingAcceptedResponse {
  decision: "accepted";
  pingId: string;
  roomId: string;
  recordedAt: string;
  receivedAt: string;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters?: number;
}

export interface AthletePingRejectedResponse {
  decision: "rejected";
  reason: AthletePingRejectReason;
  message: string;
}

/** In-memory decision log entry (WS2 Task 1) */
export interface AthletePingHistoryEntry {
  id: string;
  at: string;
  actor: string;
  decision: "accepted" | "rejected";
  reason?: AthletePingRejectReason;
  pingId?: string;
}

// --- WS3: crew orchestration & protocol execution (Sprint 1 read models) ---
// Shapes align with ws3-crew-orchestration-and-protocol-execution-plan.md; persistence defers to WS7.

/** Athlete / crew intent for a single course checkpoint (aid-station planning). */
export interface CheckpointPlan {
  id: string;
  roomId: string;
  /** Matches `RaceCourseCheckpoint.id` when the room has an activated course. */
  checkpointId: string;
  title: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  authoredByUserId: string;
}

export type CrewTaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

/** Executable unit of crew work at a checkpoint. */
export interface CrewTask {
  id: string;
  roomId: string;
  checkpointId: string;
  checkpointPlanId?: string;
  title: string;
  description?: string;
  status: CrewTaskStatus;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
}

/** Role-scoped assignment of a task to a crew member. */
export interface CrewAssignment {
  id: string;
  roomId: string;
  taskId: string;
  assigneeUserId: string;
  assigneeRole: Role;
  assignedByUserId: string;
  assignedAt: string;
}

export type ProtocolNoteCategory = "heat" | "nutrition" | "blister" | "other";

/** Shared protocol content (heat, nutrition, blister, etc.) at checkpoint scope. */
export interface ProtocolNote {
  id: string;
  roomId: string;
  checkpointId: string;
  category: ProtocolNoteCategory;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorUserId: string;
}

/** Ordered ops feed derived from task + protocol activity (append-friendly). */
export type OpsTimelineEventKind =
  | "task_created"
  | "task_assigned"
  | "task_started"
  | "task_completed"
  | "protocol_updated"
  | "timeline_note_added";

export interface OpsTimelineEvent {
  id: string;
  roomId: string;
  occurredAt: string;
  kind: OpsTimelineEventKind;
  actorUserId: string;
  /** Short line for crew timeline UIs. */
  message: string;
  taskId?: string;
  protocolNoteId?: string;
}

// --- WS4: structured incidents and adaptive plan loop (Sprint 1) ---
// Shapes align with ws4-structured-incidents-and-adaptive-plan-loop-plan.md; persistence defers to WS7.

export type IncidentCategory =
  | "fuel"
  | "hydration"
  | "aid_duration"
  | "equipment"
  | "protocol_deviation"
  | "other";

export type IncidentSeverity = "low" | "medium" | "high";

/** Structured crew observation during race operations. */
export interface IncidentEvent {
  id: string;
  roomId: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  /** Optional link to a course checkpoint when the room has a course. */
  checkpointId?: string;
  summary: string;
  details?: string;
  reportedByUserId: string;
  recordedAt: string;
}

export type RecommendationStatus = "pending" | "accepted" | "rejected";

/** Reviewable plan adjustment proposal derived from an incident (Sprint 1 may use deterministic stubs). */
export interface Recommendation {
  id: string;
  roomId: string;
  incidentId: string;
  rationale: string;
  proposedSummary: string;
  status: RecommendationStatus;
  createdAt: string;
  decidedAt?: string;
  decidedByUserId?: string;
}

/** Immutable published plan snapshot after acceptance (in-memory for Sprint 1). */
export interface PlanVersion {
  id: string;
  roomId: string;
  /** Monotonic per room (1-based). */
  version: number;
  parentVersionId: string | null;
  rationale: string;
  createdAt: string;
  acceptedRecommendationId?: string;
}

/** Human-readable delta between two plan versions (Sprint 1 keeps strings only). */
export interface PlanDelta {
  roomId: string;
  fromVersion: number;
  toVersion: number;
  changes: string[];
}

/** Minimal explainability payload for a recommendation (expand in WS7). */
export interface ExplainabilityRecord {
  id: string;
  recommendationId: string;
  factors: string[];
  createdAt: string;
}

// --- WS5: connectivity resilience and sync health (Sprint 1 HTTP slice) ---
// Shapes align with ws5-connectivity-resilience-and-sync-health-plan.md; BLE + canonical merge defer to later slices.

export type LocalOpQueueItemStatus = "pending" | "flushed" | "failed";

/** Single queued client operation (for future flush/replay; Sprint 1 may only surface summaries). */
export interface LocalOpQueueItem {
  id: string;
  roomId: string;
  deviceId: string;
  userId: string;
  opType: string;
  payloadSummary: string;
  clientCreatedAt: string;
  status: LocalOpQueueItemStatus;
  serverSeenAt: string;
}

/** Per-device sync heartbeat as observed by the API (server clock). */
export interface DeviceHealth {
  deviceId: string;
  roomId: string;
  userId: string;
  lastHeartbeatAt: string;
  pendingQueueCount: number;
  lastSuccessfulFlushAt?: string;
  /** Computed on read: true when lastHeartbeat is older than the caller’s stale threshold. */
  isStale: boolean;
}

/** Aggregated operator-facing sync view for a room. */
export interface SyncStatus {
  roomId: string;
  evaluatedAt: string;
  staleAfterSeconds: number;
  devices: DeviceHealth[];
  totalPendingAcrossDevices: number;
}

/** Client-reported queue shape snapshot (counts only). */
export interface SyncQueueDiagnostics {
  id: string;
  roomId: string;
  deviceId: string;
  userId: string;
  pendingByOpType: Record<string, number>;
  reportedAt: string;
}

export type MergeStrategyKind = "last_writer_wins" | "manual" | "deferred";

/** Client-reported merge decision (telemetry; WS7 owns authoritative merge). */
export interface MergeRecord {
  id: string;
  roomId: string;
  deviceId: string;
  conflictKey: string;
  strategy: MergeStrategyKind;
  decidedByUserId: string;
  recordedAt: string;
  notes?: string;
}

// --- WS6: team command center and multi-athlete concurrency (Sprint 1) ---
// Shapes align with ws6-team-command-center-and-multi-athlete-concurrency-plan.md; persistence defers to WS7.

export type CommandCenterMetricKind =
  | "calories_per_hr"
  | "carbs_per_hr"
  | "electrolytes_per_hr"
  | "sodium_per_hr";

/** Manager-selected metrics surfaced on multi-athlete status cards. */
export interface TeamCommandMetricConfig {
  teamId: string;
  selectedMetrics: CommandCenterMetricKind[];
  updatedAt: string;
  updatedByUserId: string;
}

export type AthleteMetricBand = "unknown" | "ok" | "warn" | "critical";

export interface AthleteStatusCardMetricCell {
  metric: CommandCenterMetricKind;
  /** null until live nutrition streams exist; Sprint 1 uses deterministic stubs for UI wiring. */
  value: number | null;
  band: AthleteMetricBand;
}

export interface AthleteStatusCard {
  roomId: string;
  athleteId: string;
  roomName: string;
  roomStatus: RaceRoomStatus;
  /** Present when an active room has a stored projection read model. */
  projection?: RaceRoomProjection;
  taskCounts: {
    pending: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  };
  /** Roll-up of WS5 heartbeat telemetry for the room (zeros when none reported). */
  syncSummary: {
    totalPendingAcrossDevices: number;
    staleDeviceCount: number;
    trackedDeviceCount: number;
  };
  metrics: AthleteStatusCardMetricCell[];
}

export interface TeamCommandBoard {
  teamId: string;
  evaluatedAt: string;
  metricConfig: TeamCommandMetricConfig;
  cards: AthleteStatusCard[];
}

export {
  DESIGN_SYSTEMS,
  DEFAULT_DESIGN_SYSTEM_ID,
  type DesignSystemDefinition,
  type DesignSystemId,
  type DesignSystemMode,
  type DesignSystemVariant
} from "./designSystems.js";

export {
  ACTIVITY_HISTORY_SOURCES,
  CUTOFF_WARN_MARGIN_SECONDS,
  CUTOFF_WARNING_STATUSES,
  PACING_BAND_KINDS,
  WAYPOINT_TAGS,
  isActivityHistorySource,
  isCutoffWarningStatus,
  isPacingBandKind,
  isWaypointTag,
  parseActivityHistoryRef,
  parseCrewScheduleSheet,
  parseDistanceMeters,
  parseDurationSeconds,
  parseIso8601Utc,
  parsePacingEstimate,
  parseScheduleStop,
  parseWaypointTags,
  type ActivityHistoryRef,
  type ActivityHistorySource,
  type CrewScheduleSheet,
  type CutoffWarningStatus,
  type PacingAidEta,
  type PacingBandKind,
  type PacingEstimate,
  type PacingTimePoint,
  type ScheduleStop,
  type ScheduleStopNotesRef,
  type RaceRoomStopPlan,
  type StopPlanNote,
  type WaypointTag
} from "./pacingSchedule.js";

export type StaffingOverlapSeverity = "warning" | "blocking";

/** Same crew identity holds in-progress work across two or more concurrent race rooms. */
export interface StaffingOverlap {
  id: string;
  assigneeUserId: string;
  roomIds: string[];
  checkpointIds: string[];
  severity: StaffingOverlapSeverity;
  note: string;
}

export interface CheckpointDemandCell {
  checkpointId: string;
  /** Number of distinct active rooms with open crew demand at this checkpoint. */
  concurrentRoomDemand: number;
  contributingRoomIds: string[];
}

export interface CheckpointDemandHeatmap {
  teamId: string;
  evaluatedAt: string;
  cells: CheckpointDemandCell[];
}

// --- WS7: shared platform contracts and data model (Sprint 1) ---
// Aligns with ws7-shared-platform-contracts-and-data-model-plan.md and ADR 0003 (PostgreSQL append-only is a later slice).

/**
 * Current published contract batch for platform events.
 * @see docs/sdlc/ws7-schema-compatibility.md
 */
export const PLATFORM_SCHEMA_VERSION = "2026.05.0" as const;
export type PlatformSchemaVersion = typeof PLATFORM_SCHEMA_VERSION;

/** Transport surface that produced or carried an event (BLE secondary path per master plan). */
export type TransportChannel = "cloud" | "ble";

/** Canonical aggregate roots referenced across WS1–WS6. */
export type PlatformAggregateType =
  | "team"
  | "race_room"
  | "athlete"
  | "crew_member"
  | "checkpoint"
  | "task"
  | "plan_version"
  | "projection"
  | "sync"
  | "command_board";

/** Cross-workstream lifecycle catalog (extend intentionally; unknown names fail HTTP validation until registered). */
export type PlatformEventName =
  | "race_room.draft_created"
  | "race_room.activated"
  | "race_room.completed"
  | "membership.invited"
  | "membership.accepted"
  | "athlete_ping.accepted"
  | "projection.recomputed"
  | "task.created"
  | "task.status_changed"
  | "incident.recorded"
  | "recommendation.decided"
  | "plan_version.recorded"
  | "sync.heartbeat_reported"
  | "merge.recorded";

export interface RaceRoomDraftCreatedPayload {
  teamId: string;
  athleteId: string;
  name: string;
}

export interface RaceRoomActivatedPayload {
  eventEndsAt: string;
}

export interface PlanVersionRecordedPayload {
  version: number;
  planVersionId: string;
  rationale: string;
}

/**
 * Append-only envelope for the canonical event log.
 * Sprint 1 persists in API memory; WS0/ADR-0003 maps this row shape to PostgreSQL later.
 */
export interface PlatformEventEnvelope<TPayload = unknown> {
  id: string;
  aggregateId: string;
  aggregateType: PlatformAggregateType;
  eventType: PlatformEventName;
  occurredAt: string;
  /** Monotonic per `(aggregateType, aggregateId)` for deterministic replay. */
  sequence: number;
  idempotencyKey: string;
  payload: TPayload;
  schemaVersion: string;
  transport: TransportChannel;
  actorUserId: string;
  correlationId?: string;
  causationId?: string;
}

/** Canonical `Team` node in the master entity graph. */
export interface PlatformTeam {
  id: string;
  name: string;
  createdAt: string;
}

/** Canonical athlete identity under a team (distinct from a `RaceRoom.athleteId` user handle). */
export interface PlatformAthlete {
  id: string;
  teamId: string;
  linkedUserId: string;
  displayName: string;
}

/** Canonical crew roster entry under a team. */
export interface PlatformCrewMemberEntity {
  id: string;
  teamId: string;
  linkedUserId: string;
  role: Role;
}

/** Course or room-scoped checkpoint definition. */
export interface PlatformCheckpointEntity {
  id: string;
  scopeId: string;
  latitude: number;
  longitude: number;
}

/** Executable task bound to a race room and checkpoint (aligns with WS3 `CrewTask` semantics). */
export interface PlatformTaskEntity {
  id: string;
  roomId: string;
  checkpointId: string;
  title: string;
  status: CrewTaskStatus;
}

/** Versioned plan snapshot (same shape as WS4 `PlanVersion`; alias for clarity in entity graph). */
export type PlatformPlanVersionEntity = PlanVersion;

export type ReplayableRaceRoomStatus = RaceRoomStatus | "unknown";

/** Deterministic projection of `race_room` aggregate state from ordered platform events (Sprint 1 reducer). */
export interface ReplayedRaceRoomAggregate {
  aggregateId: string;
  teamId?: string;
  athleteId?: string;
  name?: string;
  status: ReplayableRaceRoomStatus;
  lastPlanVersion?: number;
  lastActivatedEventEndsAt?: string;
}

// --- Crew chat contracts (MVP: plaintext on Stream) ---
// Message bodies are normal Stream `text`. The API mints Stream tokens, stores
// push devices and notification prefs, and fans out push with a short preview.
// End-to-end encryption was removed for MVP reliability; any future crypto must
// be a blank-slate redesign (do not revive the retired room-key/envelope model).

/** Mints a short-lived Stream Chat user token bound to the authenticated user. */
export interface ChatStreamTokenResponse {
  /** Stream Chat user token (JWT signed with the server-side Stream secret). */
  token: string;
  /** The Stream user id used for this client session (matches the auth subject). */
  streamUserId: string;
  /** Stream Chat API key (public, safe to embed in clients). */
  streamApiKey: string;
}

/** Returns the deterministic Stream channel id for a CrewCue race room. */
export function chatChannelIdForRoom(roomId: string): string {
  return `crew-${roomId}`;
}

export type ChatPushPlatform = "ios" | "android" | "web";

/** Push device registration (transport only). */
export interface ChatPushDeviceRegistration {
  deviceId: string;
  platform: ChatPushPlatform;
  token: string;
}

export interface ChatPushDeviceRecord extends ChatPushDeviceRegistration {
  userId: string;
  registeredAt: string;
}

export type ChatNotificationPref = "all" | "mentions" | "none";

export interface ChatNotificationPrefRecord {
  userId: string;
  roomId: string;
  preference: ChatNotificationPref;
  updatedAt: string;
}

/** @deprecated Use ChatPushDeviceRegistration */
export type ChatPushTokenRegistration = ChatPushDeviceRegistration;

/** @deprecated Use ChatPushDeviceRecord */
export type ChatPushTokenRecord = ChatPushDeviceRecord;

/**
 * Stream Chat push webhook payload (subset). The server uses this to fan out
 * APNS/FCM with a short plaintext preview (or generic fallback copy).
 */
export interface ChatPushWebhookPayload {
  channelId: string;
  /** Stream user id of the sender. */
  senderUserId: string;
  /** Recipient user ids excluding the sender. */
  recipientUserIds: string[];
  /** Crew room id this channel maps to. */
  roomId: string;
  /** Mentioned user ids inside the message body. */
  mentionedUserIds?: string[];
  /** Optional short plaintext preview for the notification body. */
  previewText?: string;
}

/** Result of a retention deletion job run for a single room. */
export interface ChatRetentionResult {
  roomId: string;
  deletedAt: string;
  prefsPurged: number;
  pushTokensPurged: number;
}
