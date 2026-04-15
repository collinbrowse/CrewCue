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
