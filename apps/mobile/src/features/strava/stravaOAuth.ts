/** Default deep link when API uses custom-scheme redirect (local only). */

export const STRAVA_DEEP_LINK_REDIRECT_URI = "crewcue://strava";

export type StravaOAuthCallbackParams = {
  code: string;
  state: string;
};

export type StravaOAuthCallbackResult =
  | { ok: true; params: StravaOAuthCallbackParams }
  | { ok: false; message: string };

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

/** True for OAuth callback URLs handled by Strava connect (not app navigation). */
export function isStravaOAuthDeepLink(url: string): boolean {
  try {
    const normalized = url.includes("://") ? url : `crewcue://${url}`;
    return isStravaOAuthCallbackPath(new URL(normalized));
  } catch {
    return false;
  }
}

/**
 * Parse Strava OAuth callback URLs from `openAuthSessionAsync`.
 * Supports `crewcue://strava?…` and HTTPS `/strava/oauth/redirect?…` (Strava-approved domain).
 */
export function parseStravaOAuthCallbackUrl(url: string): StravaOAuthCallbackParams | undefined {
  const result = parseStravaOAuthCallbackResult(url);
  return result.ok ? result.params : undefined;
}

/** Parse OAuth callback URL from `openAuthSessionAsync` (success or Strava error bounce). */
export function parseStravaOAuthCallbackResult(url: string): StravaOAuthCallbackResult {
  try {
    const normalized = url.includes("://") ? url : `crewcue://${url}`;
    const parsed = new URL(normalized);
    if (!isStravaOAuthCallbackPath(parsed)) {
      return { ok: false, message: `Unexpected Strava callback URL (${url})` };
    }
    const oauthError = parsed.searchParams.get("error")?.trim();
    if (oauthError) {
      const detail = parsed.searchParams.get("error_description")?.trim();
      return {
        ok: false,
        message: detail ? `Strava authorization failed: ${detail}` : `Strava authorization failed (${oauthError})`
      };
    }
    const params = readOAuthQueryParams(parsed);
    if (!params) {
      return { ok: false, message: `Strava callback was missing code or state (${url})` };
    }
    return { ok: true, params };
  } catch {
    return { ok: false, message: `Invalid Strava callback URL (${url})` };
  }
}
