/**
 * Strava HTTP client (token exchange, refresh, activity list).
 * Fetch is injectable for unit tests — never hit live Strava in CI.
 */
export type StravaTokenBundle = {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the access token expires. */
  expiresAt: number;
  athleteId: string;
};

export type StravaClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Default: activity:read_all */
  scope?: string;
  fetchImpl?: typeof fetch;
};

export class StravaClientError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "StravaClientError";
    this.code = code;
    this.status = status;
  }
}

const AUTHORIZE_BASE = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
/** Recommended deauthorization endpoint (Strava docs; preferred over /oauth/deauthorize). */
const REVOKE_URL = "https://www.strava.com/oauth/revoke";

export function readStravaEnvConfig(): StravaClientConfig | undefined {
  const clientId = process.env.STRAVA_CLIENT_ID?.trim();
  const clientSecret = process.env.STRAVA_CLIENT_SECRET?.trim();
  const redirectUri = process.env.STRAVA_REDIRECT_URI?.trim() || "crewcue://strava";
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildStravaAuthorizeUrl(
  config: StravaClientConfig,
  state: string
): string {
  const scope = config.scope ?? "activity:read_all";
  const url = new URL(AUTHORIZE_BASE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  athlete?: { id?: number | string };
};

function parseTokenResponse(body: unknown): StravaTokenBundle {
  if (!body || typeof body !== "object") {
    throw new StravaClientError("Invalid token response", "strava_token_invalid");
  }
  const data = body as TokenResponse;
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string" ||
    typeof data.expires_at !== "number" ||
    !Number.isFinite(data.expires_at)
  ) {
    throw new StravaClientError("Incomplete token response", "strava_token_invalid");
  }
  const athleteId = data.athlete?.id !== undefined ? String(data.athlete.id) : "";
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteId
  };
}

async function postToken(
  config: StravaClientConfig,
  body: Record<string, string>
): Promise<StravaTokenBundle> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...body
    })
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : typeof parsed === "string" && parsed.length > 0
          ? parsed
          : undefined;
    throw new StravaClientError(
      detail
        ? `Strava token request failed (${res.status}): ${detail}`
        : `Strava token request failed (${res.status})`,
      "strava_token_http",
      res.status
    );
  }
  return parseTokenResponse(parsed);
}

export async function exchangeStravaAuthorizationCode(
  config: StravaClientConfig,
  code: string
): Promise<StravaTokenBundle> {
  const tokens = await postToken(config, {
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri
  });
  if (!tokens.athleteId) {
    throw new StravaClientError("Token response missing athlete id", "strava_token_invalid");
  }
  return tokens;
}

export async function refreshStravaAccessToken(
  config: StravaClientConfig,
  refreshToken: string
): Promise<StravaTokenBundle> {
  return postToken(config, { refresh_token: refreshToken, grant_type: "refresh_token" });
}

/**
 * Ensure access token is valid; refresh when within 60s of expiry.
 * Returns the (possibly updated) token bundle.
 */
export async function ensureFreshStravaAccessToken(
  config: StravaClientConfig,
  tokens: StravaTokenBundle,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ tokens: StravaTokenBundle; refreshed: boolean }> {
  if (tokens.expiresAt > nowSeconds + 60) {
    return { tokens, refreshed: false };
  }
  const next = await refreshStravaAccessToken(config, tokens.refreshToken);
  // Refresh responses may omit athlete; preserve prior athleteId.
  const merged: StravaTokenBundle = {
    ...next,
    athleteId: next.athleteId || tokens.athleteId
  };
  return { tokens: merged, refreshed: true };
}

/**
 * Revoke the athlete's OAuth grant for this app (invalidates access + refresh tokens).
 * Uses POST /oauth/revoke with HTTP Basic (client_id:client_secret).
 * Prefer the refresh token so revoke still works if the access token already expired.
 */
export async function deauthorizeStravaAccess(
  config: StravaClientConfig,
  tokens: Pick<StravaTokenBundle, "accessToken" | "refreshToken">
): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    token: tokens.refreshToken || tokens.accessToken,
    token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token"
  });
  const res = await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });
  // Strava returns 200 whether or not the token was found; treat other statuses as failure.
  if (!res.ok) {
    throw new StravaClientError(
      `Strava deauthorize request failed (${res.status})`,
      "strava_deauthorize_http",
      res.status
    );
  }
}

export async function listStravaAthleteActivities(
  config: StravaClientConfig,
  accessToken: string,
  options?: { page?: number; perPage?: number; after?: number }
): Promise<unknown[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const page = options?.page ?? 1;
  const perPage = options?.perPage ?? 30;
  const url = new URL(ACTIVITIES_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  if (options?.after !== undefined) {
    url.searchParams.set("after", String(options.after));
  }
  const res = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new StravaClientError(
      `Strava activities request failed (${res.status})`,
      "strava_activities_http",
      res.status
    );
  }
  if (!Array.isArray(parsed)) {
    throw new StravaClientError("Activities response must be an array", "strava_activities_invalid");
  }
  return parsed;
}

/** Lookback window for pacing history sync (~1 calendar year). */
export const STRAVA_SYNC_LOOKBACK_SECONDS = 365 * 24 * 60 * 60;

/** Strava allows up to 200 activities per page. */
export const STRAVA_ACTIVITIES_PER_PAGE = 200;

/** Safety cap so a buggy client cannot loop forever. */
const STRAVA_SYNC_MAX_PAGES = 50;

/**
 * List athlete activities after `afterSeconds` (default: now − 1 year), paginating until exhausted.
 * Sport filtering happens in the mapper; this returns the raw Strava window.
 */
export async function listStravaAthleteActivitiesSince(
  config: StravaClientConfig,
  accessToken: string,
  options?: { afterSeconds?: number; perPage?: number; nowSeconds?: number }
): Promise<unknown[]> {
  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const after = options?.afterSeconds ?? nowSeconds - STRAVA_SYNC_LOOKBACK_SECONDS;
  const perPage = options?.perPage ?? STRAVA_ACTIVITIES_PER_PAGE;
  const collected: unknown[] = [];

  for (let page = 1; page <= STRAVA_SYNC_MAX_PAGES; page += 1) {
    const batch = await listStravaAthleteActivities(config, accessToken, {
      page,
      perPage,
      after
    });
    collected.push(...batch);
    if (batch.length < perPage) {
      break;
    }
  }

  return collected;
}
