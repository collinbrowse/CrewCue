/**
 * #538 / #493: who may change a race room's plan-of-record pacing estimate, and why.
 *
 * - The race athlete (`room.athleteId`) may update it for any reason, including automatic
 *   recomputes when their history changes.
 * - Every crew role (crew member, crew chief, team manager) may only seed a cold start while
 *   the room has no plan of record, or explicitly Recalculate. Either way the estimate is built
 *   from the athlete's history and owned by the athlete. This is the issue's wording ("crew may
 *   only seed a cold start or tap Recalculate") and matches client-core `PlanAuthority`.
 * - Everyone else may not change the plan.
 * - The plan is built from the room's athlete only while they are a current member. A room
 *   with no athlete yet (`athleteId` empty: created by crew, nobody has accepted the athlete
 *   invite) has no plan to compute, so every trigger answers 409 `athlete_not_joined`.
 */
import { z } from "zod";
import type { RaceRoom } from "@crewcue/contracts";

/** Mirrors client-core `PlanAuthority.mayExplicitRecalculate` / `maySeedColdStart`. */
export const PLAN_CREW_ROLES: readonly string[] = ["crew_member", "crew_chief", "team_manager"];

export const planTriggerSchema = z.enum(["auto", "cold_start", "recalculate"]);
export type PlanTrigger = z.infer<typeof planTriggerSchema>;

export type PlanAuthorityDecision =
  | { ok: true; historyOwnerUserId: string }
  | { ok: false; status: 403; error: string; code: "plan_authority" }
  | { ok: false; status: 409; error: string; code: "athlete_not_joined" };

export function isRoomAthlete(room: Pick<RaceRoom, "athleteId">, userId: string): boolean {
  return room.athleteId !== "" && room.athleteId === userId;
}

/**
 * The room's athlete while they are on its roster, else undefined. The server sets `athleteId`
 * (the creator who creates as the athlete, or whoever accepts the athlete invite); a room stored
 * before that may name someone who never joined, and their history is not the room's to read.
 */
export function roomAthleteMember(room: Pick<RaceRoom, "athleteId" | "memberships">): string | undefined {
  const athleteId = room.athleteId;
  if (athleteId === "") return undefined;
  return room.memberships.some((member) => member.userId === athleteId) ? athleteId : undefined;
}

export function decidePlanAuthority(input: {
  room: Pick<RaceRoom, "athleteId" | "pacingEstimateId" | "memberships">;
  userId: string;
  /** The caller's membership role in the room. */
  role: string;
  trigger: PlanTrigger;
}): PlanAuthorityDecision {
  const { room, userId, role, trigger } = input;
  const athlete = roomAthleteMember(room);
  if (athlete !== undefined && athlete === userId) {
    return { ok: true, historyOwnerUserId: userId };
  }
  if (!PLAN_CREW_ROLES.includes(role)) {
    return deny("Only the athlete or the crew may change the plan of record");
  }
  if (athlete === undefined) {
    return {
      ok: false,
      status: 409,
      error: "The race has no athlete yet. The plan is built once the athlete joins.",
      code: "athlete_not_joined"
    };
  }
  if (trigger === "auto") {
    return deny("Only the athlete's history updates the plan of record automatically");
  }
  if (trigger === "cold_start" && room.pacingEstimateId !== undefined) {
    return deny("The room already has a plan of record; use Recalculate");
  }
  return { ok: true, historyOwnerUserId: athlete };
}

function deny(error: string): PlanAuthorityDecision {
  return { ok: false, status: 403, error, code: "plan_authority" };
}
