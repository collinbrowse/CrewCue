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
}

export interface RaceCourse {
  checkpoints: RaceCourseCheckpoint[];
}

export interface RaceCheckpointSplitRow {
  checkpointId: string;
  distanceMetersFromStart: number;
  crossedAtRecordedAt: string | null;
  plannedElapsedSecondsAtCross: number;
  actualElapsedSecondsAtCross: number | null;
  deltaSecondsAtCross: number | null;
}

/** Deterministic split/ETA math from the last accepted ping. */
export interface RaceRoomProjectionCore {
  roomId: string;
  asOfPingId: string;
  asOfRecordedAt: string;
  progressMeters: number;
  courseLengthMeters: number;
  plannedPaceSecondsPerKm: number;
  etaFinishPlanIso: string;
  checkpointSplits: RaceCheckpointSplitRow[];
}

export type ProjectionConfidence = "fresh" | "degraded";

/** Server-computed freshness for projection reads (WS2 Task 3). */
export interface ProjectionTimeliness {
  projectionConfidence: ProjectionConfidence;
  /** Effective threshold: env default, or ~2.5× last declared `uploadIntervalSeconds` when the client sends it (bounded). */
  stalenessThresholdSeconds: number;
  secondsSinceLastAcceptedPing: number;
  evaluatedAt: string;
}

export type RaceRoomProjection = RaceRoomProjectionCore & ProjectionTimeliness;

export interface RaceRoom {
  id: string;
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
