/**
 * Minimal JWT payload inspection for UX only.
 *
 * We do NOT verify the signature on-device — the API is the trust boundary
 * for authorization. This helper just surfaces `sub`, `email`, and the
 * CrewCue custom claims so the user can see who they logged in as.
 */

export type DecodedAccessClaims = {
  sub?: string;
  email?: string;
  teamIds?: string[];
  roomRoles?: Record<string, string>;
  exp?: number;
};

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (input.length % 4)) % 4);
  if (typeof globalThis.atob === "function") {
    return decodeURIComponent(
      Array.prototype.map
        .call(globalThis.atob(padded), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function decodeAccessTokenClaims(accessToken: string): DecodedAccessClaims | undefined {
  const parts = accessToken.split(".");
  if (parts.length < 2 || !parts[1]) {
    return undefined;
  }
  try {
    const json = base64UrlDecode(parts[1]);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const claims: DecodedAccessClaims = {};
    if (typeof parsed.sub === "string") claims.sub = parsed.sub;
    if (typeof parsed.email === "string") claims.email = parsed.email;
    const teamIdsRaw = parsed.teamIds ?? parsed.team_ids;
    if (Array.isArray(teamIdsRaw)) {
      claims.teamIds = teamIdsRaw.filter((x): x is string => typeof x === "string");
    }
    const roomRolesRaw = parsed.roomRoles ?? parsed.room_roles;
    if (roomRolesRaw && typeof roomRolesRaw === "object" && !Array.isArray(roomRolesRaw)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(roomRolesRaw as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      claims.roomRoles = out;
    }
    if (typeof parsed.exp === "number") claims.exp = parsed.exp;
    return claims;
  } catch {
    return undefined;
  }
}
