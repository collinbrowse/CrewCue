/** Strava OAuth redirect helpers (W3-2). Redirect URI must match API `STRAVA_REDIRECT_URI`. */

export const STRAVA_REDIRECT_URI = "crewcue://strava";

export type StravaOAuthCallbackParams = {
  code: string;
  state: string;
};

/**
 * Parse `crewcue://strava?code=…&state=…` callback URLs from openAuthSessionAsync.
 */
export function parseStravaOAuthCallbackUrl(url: string): StravaOAuthCallbackParams | undefined {
  try {
    const normalized = url.includes("://") ? url : `crewcue://${url}`;
    const parsed = new URL(normalized);
    const host = parsed.hostname || parsed.host;
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    const isStrava =
      host === "strava" || path === "strava" || `${host}/${path}`.replace(/\/+$/, "") === "strava";
    if (!isStrava) {
      return undefined;
    }
    const code = parsed.searchParams.get("code")?.trim() ?? "";
    const state = parsed.searchParams.get("state")?.trim() ?? "";
    if (!code || !state) {
      return undefined;
    }
    return { code, state };
  } catch {
    return undefined;
  }
}
