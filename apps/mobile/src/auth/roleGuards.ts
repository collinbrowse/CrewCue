import type { Role } from "@crewcue/contracts";
import type { AuthState } from "./useAuth";

export function canMutateCheckpointStoppage(auth: AuthState): boolean {
  if (auth.status !== "authenticated" || !auth.claims?.sub) {
    return false;
  }
  const roles = auth.claims.roomRoles;
  if (!roles || typeof roles !== "object") {
    return false;
  }
  const allowed = ["crew_member", "crew_chief", "team_manager"];
  return Object.values(roles).some((role) => typeof role === "string" && allowed.includes(role));
}

export function getCurrentRoomRole(auth: AuthState, roomId?: string): Role | undefined {
  if (!roomId || auth.status !== "authenticated") {
    return undefined;
  }
  const role = auth.claims?.roomRoles?.[roomId];
  if (role === "athlete" || role === "crew_member" || role === "crew_chief" || role === "team_manager") {
    return role;
  }
  return undefined;
}

export function canMutateTaskBoard(auth: AuthState, roomId?: string): boolean {
  const role = getCurrentRoomRole(auth, roomId);
  return role === "crew_member" || role === "crew_chief" || role === "team_manager";
}

/** Matches server `canRecordMergeTelemetry` for POST /sync/merge-records (telemetry). */
export function canRecordMergeTelemetry(role: Role | undefined): boolean {
  return role === "athlete" || role === "crew_chief" || role === "team_manager";
}
