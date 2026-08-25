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

export async function listStravaAthleteActivities(
  config: StravaClientConfig,
  accessToken: string,
  options?: { page?: number; perPage?: number }
): Promise<unknown[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const page = options?.page ?? 1;
  const perPage = options?.perPage ?? 30;
  const url = new URL(ACTIVITIES_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
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
