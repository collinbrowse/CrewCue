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
}

/** Ordered polyline for WS2 projection (local XY projection between consecutive points). */
export interface RaceCourseCheckpoint {
  id: string;
  latitude: number;
  longitude: number;
  plannedStopSeconds?: number;
  stoppageRadiusMeters?: number;
  slowdownThresholdRatio?: number;
}

/** Optional non-linear baseline profile used for WS2 planned split / ETA projections. */
export interface RaceCourseBaselinePoint {
  distanceMetersFromStart: number;
  referenceElapsedSeconds: number;
}

export interface RaceCourseBaselineTrack {
  points: RaceCourseBaselinePoint[];
}

export interface RaceCourse {
  checkpoints: RaceCourseCheckpoint[];
  /** Optional high-density reference track; older clients can omit this and retain flat pace behavior. */
  baselineTrack?: RaceCourseBaselineTrack;
}

export interface RaceCheckpointSplitRow {
  checkpointId: string;
  distanceMetersFromStart: number;
  crossedAtRecordedAt: string | null;
  plannedElapsedSecondsAtCross: number;
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
}

export type ProjectionConfidence = "fresh" | "degraded";

/** Wall-clock freshness for reads (WS2 Task 3); computed when the response is built. */
export interface ProjectionTimeliness {
  projectionConfidence: ProjectionConfidence;
  /**
   * Effective threshold: `PROJECTION_STALE_AFTER_SECONDS` (default 120), or when the client declares
   * `uploadIntervalSeconds` on accepted pings, `clamp(round(2.5 × interval), 45, 600)`.
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
  activatedAt?: string;
  eventEndsAt?: string;
  memberships: RaceRoomMembership[];
  entitlement: RaceRoomEntitlement;
  /** Set on activation; drives WS2 split / ETA projection. */
  course?: RaceCourse;
  /** Persisted at upload time for fast UI reads without recomputation. */
  courseDistanceMeters?: number;
  /** Persisted at upload time for fast UI reads without recomputation. */
  courseElevationGainMeters?: number;
  /** Original uploaded filename for route metadata display. */
  courseFileName?: string;
  /** Seconds per kilometre for plan baseline (smaller = faster plan). */
  plannedPaceSecondsPerKm?: number;
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
   * When set, the server derives projection staleness threshold ≈ 2.5× this value (bounded).
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
