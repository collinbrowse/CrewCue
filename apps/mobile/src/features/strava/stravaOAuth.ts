/** Default deep link when API uses custom-scheme redirect (local only). */

export const STRAVA_DEEP_LINK_REDIRECT_URI = "crewcue://strava";

export type StravaOAuthCallbackParams = {
  code: string;
  state: string;
};

function readOAuthQueryParams(parsed: URL): StravaOAuthCallbackParams | undefined {
  const code = parsed.searchParams.get("code")?.trim() ?? "";
  const state = parsed.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return undefined;
  }
  return { code, state };
}

function isStravaOAuthCallbackPath(parsed: URL): boolean {
  const host = parsed.hostname || parsed.host;
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (host === "strava" || path === "strava") {
    return true;
  }
  if (path === "strava/oauth/redirect" || path.endsWith("/strava/oauth/redirect")) {
    return true;
  }
  return false;
}

/**
 * Parse Strava OAuth callback URLs from `openAuthSessionAsync`.
 * Supports `crewcue://strava?…` and HTTPS `/strava/oauth/redirect?…` (Strava-approved domain).
 */
export function parseStravaOAuthCallbackUrl(url: string): StravaOAuthCallbackParams | undefined {
  try {
    const normalized = url.includes("://") ? url : `crewcue://${url}`;
    const parsed = new URL(normalized);
    if (!isStravaOAuthCallbackPath(parsed)) {
      return undefined;
    }
    return readOAuthQueryParams(parsed);
  } catch {
    return undefined;
  }
}
