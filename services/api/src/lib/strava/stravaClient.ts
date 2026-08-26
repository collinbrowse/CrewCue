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
  /** Granted scopes from token response when Strava includes them. */
  scope?: string;
};

export type StravaClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Default: read,activity:read_all */
  scope?: string;
  fetchImpl?: typeof fetch;
};

/** Scopes required to list athlete activities for pacing history. */
export const STRAVA_DEFAULT_AUTHORIZE_SCOPE = "read,activity:read_all";

/** True when granted scopes include activity:read or activity:read_all. */
export function stravaScopeIncludesActivityRead(scope: string | undefined): boolean {
  if (!scope?.trim()) return false;
  const parts = scope.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  return parts.includes("activity:read") || parts.includes("activity:read_all");
}

export function assertStravaActivityReadScope(scope: string | undefined): void {
  if (stravaScopeIncludesActivityRead(scope)) return;
  throw new StravaClientError(
    "Strava did not grant activity read access. Disconnect, then Connect again and leave private activities checked.",
    "strava_scope_insufficient"
  );
}

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
  const scope = config.scope ?? STRAVA_DEFAULT_AUTHORIZE_SCOPE;
  const url = new URL(AUTHORIZE_BASE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  // Force consent so reconnect can upgrade scopes (auto reuses a prior weak grant).
  url.searchParams.set("approval_prompt", "force");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  athlete?: { id?: number | string };
  scope?: string;
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
  const scope = typeof data.scope === "string" && data.scope.trim() ? data.scope.trim() : undefined;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteId,
    scope
  };
}

function stravaHttpErrorDetail(parsed: unknown, text: string): string | undefined {
  if (parsed && typeof parsed === "object") {
    const message =
      "message" in parsed && typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message.trim()
        : "";
    const errors = "errors" in parsed ? (parsed as { errors?: unknown }).errors : undefined;
    let fieldHint = "";
    if (Array.isArray(errors) && errors.length > 0 && errors[0] && typeof errors[0] === "object") {
      const first = errors[0] as { field?: unknown; code?: unknown };
      const field = typeof first.field === "string" ? first.field : "";
      const code = typeof first.code === "string" ? first.code : "";
      if (field || code) {
        fieldHint = [field, code].filter(Boolean).join(" ");
      }
    }
    if (message && fieldHint) return `${message} (${fieldHint})`;
    if (message) return message;
    if (fieldHint) return fieldHint;
  }
  if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  if (text.trim()) return text.trim().slice(0, 200);
  return undefined;
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
    const detail = stravaHttpErrorDetail(parsed, text);
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
    const detail = stravaHttpErrorDetail(parsed, text);
    throw new StravaClientError(
      detail
        ? `Strava activities request failed (${res.status}): ${detail}`
        : `Strava activities request failed (${res.status})`,
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
