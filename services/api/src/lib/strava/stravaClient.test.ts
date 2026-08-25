import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStravaAuthorizeUrl,
  ensureFreshStravaAccessToken,
  exchangeStravaAuthorizationCode,
  listStravaAthleteActivities,
  refreshStravaAccessToken,
  type StravaClientConfig,
  type StravaTokenBundle
} from "./stravaClient.js";

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

const baseConfig = (fetchImpl: typeof fetch): StravaClientConfig => ({
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "crewcue://strava",
  fetchImpl
});

test("buildStravaAuthorizeUrl includes client_id, redirect, state, scope", () => {
  const url = buildStravaAuthorizeUrl(
    { clientId: "cid", clientSecret: "sec", redirectUri: "crewcue://strava" },
    "abc123"
  );
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://www.strava.com/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "cid");
  assert.equal(parsed.searchParams.get("redirect_uri"), "crewcue://strava");
  assert.equal(parsed.searchParams.get("state"), "abc123");
  assert.equal(parsed.searchParams.get("scope"), "activity:read_all");
  assert.equal(parsed.searchParams.get("response_type"), "code");
});

test("EC6: ensureFreshStravaAccessToken refreshes when near expiry", async () => {
  let tokenPosts = 0;
  const fetchImpl = mockFetch(async (url) => {
    if (url.includes("/oauth/token")) {
      tokenPosts += 1;
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: 9_999_999_999
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`unexpected url ${url}`);
  });
  const config = baseConfig(fetchImpl);
  const stale: StravaTokenBundle = {
    accessToken: "old",
    refreshToken: "old-refresh",
    expiresAt: 1000,
    athleteId: "55"
  };
  const result = await ensureFreshStravaAccessToken(config, stale, 995);
  assert.equal(result.refreshed, true);
  assert.equal(result.tokens.accessToken, "new-access");
  assert.equal(result.tokens.athleteId, "55");
  assert.equal(tokenPosts, 1);
});

test("ensureFreshStravaAccessToken skips refresh when token still valid", async () => {
  const fetchImpl = mockFetch(async () => {
    throw new Error("should not fetch");
  });
  const config = baseConfig(fetchImpl);
  const fresh: StravaTokenBundle = {
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 2_000_000_000,
    athleteId: "1"
  };
  const result = await ensureFreshStravaAccessToken(config, fresh, 1_000_000_000);
  assert.equal(result.refreshed, false);
  assert.equal(result.tokens.accessToken, "a");
});

test("exchangeStravaAuthorizationCode requires athlete id", async () => {
  const fetchImpl = mockFetch(async () =>
    new Response(
      JSON.stringify({
        access_token: "a",
        refresh_token: "r",
        expires_at: 100,
        athlete: { id: 77 }
      }),
      { status: 200 }
    )
  );
  const tokens = await exchangeStravaAuthorizationCode(baseConfig(fetchImpl), "code-1");
  assert.equal(tokens.athleteId, "77");
});

test("refreshStravaAccessToken posts grant_type refresh_token", async () => {
  let body = "";
  const fetchImpl = mockFetch(async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response(
      JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_at: 200 }),
      { status: 200 }
    );
  });
  await refreshStravaAccessToken(baseConfig(fetchImpl), "r1");
  assert.match(body, /refresh_token/);
  assert.match(body, /"grant_type":"refresh_token"/);
});

test("listStravaAthleteActivities returns array", async () => {
  const fetchImpl = mockFetch(async () =>
    new Response(JSON.stringify([{ id: 1, distance: 1000 }]), { status: 200 })
  );
  const items = await listStravaAthleteActivities(baseConfig(fetchImpl), "tok");
  assert.equal(items.length, 1);
});
