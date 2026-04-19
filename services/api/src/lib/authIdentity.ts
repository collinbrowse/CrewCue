import { z } from "zod";
import type { IdentityClaims, Role } from "@crewcue/contracts";

const roleSchema = z.enum(["athlete", "crew_member", "crew_chief", "team_manager"]);

function readClaim(
  payload: Record<string, unknown>,
  shortKey: string,
  underscoredKey: string,
  claimNamespace?: string,
): unknown {
  if (payload[shortKey] !== undefined) {
    return payload[shortKey];
  }
  if (payload[underscoredKey] !== undefined) {
    return payload[underscoredKey];
  }
  if (claimNamespace) {
    const ns = claimNamespace.endsWith("/") ? claimNamespace : `${claimNamespace}/`;
    for (const key of [`${ns}${shortKey}`, `${ns}${underscoredKey}`]) {
      if (payload[key] !== undefined) {
        return payload[key];
      }
    }
  }
  return undefined;
}

function parseTeamIds(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    const ids = raw.filter((x): x is string => typeof x === "string");
    return ids;
  }
  if (typeof raw === "string" && raw.length > 0) {
    return [raw];
  }
  return undefined;
}

function parseRoomRoles(raw: unknown): Record<string, Role> | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, Role> = {};
  for (const [k, v] of Object.entries(raw)) {
    const parsed = roleSchema.safeParse(v);
    if (!parsed.success) {
      return undefined;
    }
    out[k] = parsed.data;
  }
  return out;
}

/**
 * Maps a decoded JWT payload (HS256 dev token or Auth0 access token) into {@link IdentityClaims}.
 * Unknown or invalid shapes return `undefined` so the request is treated as unauthenticated.
 */
export function mapJwtPayloadToIdentity(
  decoded: Record<string, unknown>,
  options?: { claimNamespace?: string },
): IdentityClaims | undefined {
  const ns = options?.claimNamespace?.trim() || undefined;
  const subRaw = decoded.sub;
  if (typeof subRaw !== "string" || subRaw.length === 0) {
    return undefined;
  }

  const emailRaw = decoded.email;
  const email = typeof emailRaw === "string" && emailRaw.length > 0 ? emailRaw : undefined;

  const teamRaw = readClaim(decoded, "teamIds", "team_ids", ns);
  const roomRaw = readClaim(decoded, "roomRoles", "room_roles", ns);
  if (teamRaw === undefined || roomRaw === undefined) {
    return undefined;
  }

  const teamIds = parseTeamIds(teamRaw);
  const roomRoles = parseRoomRoles(roomRaw);
  if (teamIds === undefined || roomRoles === undefined) {
    return undefined;
  }

  const claims: IdentityClaims = {
    sub: subRaw,
    email,
    teamIds,
    roomRoles,
  };

  return claims;
}
