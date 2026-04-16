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
