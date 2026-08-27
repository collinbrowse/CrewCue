import test from "node:test";
import assert from "node:assert/strict";
import {
  assertStravaActivityReadScope,
  buildStravaAuthorizeUrl,
  deauthorizeStravaAccess,
  ensureFreshStravaAccessToken,
  exchangeStravaAuthorizationCode,
  listStravaAthleteActivities,
  listStravaAthleteActivitiesSince,
  refreshStravaAccessToken,
  stravaScopeIncludesActivityRead,
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
  assert.equal(parsed.searchParams.get("scope"), "read,activity:read_all");
  assert.equal(parsed.searchParams.get("approval_prompt"), "force");
  assert.equal(parsed.searchParams.get("response_type"), "code");
});

test("stravaScopeIncludesActivityRead accepts activity read scopes", () => {
  assert.equal(stravaScopeIncludesActivityRead("read,activity:read_all"), true);
  assert.equal(stravaScopeIncludesActivityRead("activity:read"), true);
  assert.equal(stravaScopeIncludesActivityRead("read"), false);
  assert.throws(
    () => assertStravaActivityReadScope("read"),
    (err: unknown) =>
      err instanceof Error && (err as { code?: string }).code === "strava_scope_insufficient"
  );
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

test("exchangeStravaAuthorizationCode requires athlete id and sends redirect_uri", async () => {
  let body = "";
  const fetchImpl = mockFetch(async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        access_token: "a",
        refresh_token: "r",
        expires_at: 100,
        athlete: { id: 77 }
      }),
      { status: 200 }
    );
  });
  const tokens = await exchangeStravaAuthorizationCode(baseConfig(fetchImpl), "code-1");
  assert.equal(tokens.athleteId, "77");
  assert.match(body, /"redirect_uri":"crewcue:\/\/strava"/);
  assert.match(body, /"grant_type":"authorization_code"/);
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

test("listStravaAthleteActivities includes Strava error detail on failure", async () => {
  const fetchImpl = mockFetch(async () =>
    new Response(
      JSON.stringify({
        message: "Authorization Error",
        errors: [{ resource: "AccessToken", field: "activity:read_permission", code: "missing" }]
      }),
      { status: 403 }
    )
  );
  await assert.rejects(
    () => listStravaAthleteActivities(baseConfig(fetchImpl), "tok"),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes("403") &&
      err.message.includes("activity:read_permission")
  );
});

test("listStravaAthleteActivitiesSince paginates with after lookback", async () => {
  const requested: string[] = [];
  const fetchImpl = mockFetch(async (url) => {
    requested.push(url);
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get("page") ?? "1");
    if (page === 1) {
      return new Response(
        JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }))),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify([{ id: 201 }]), { status: 200 });
  });
  const items = await listStravaAthleteActivitiesSince(baseConfig(fetchImpl), "tok", {
    nowSeconds: 1_700_000_000,
    afterSeconds: 1_700_000_000 - 365 * 24 * 60 * 60
  });
  assert.equal(items.length, 201);
  assert.equal(requested.length, 2);
  const first = new URL(requested[0]!);
  assert.equal(first.searchParams.get("after"), String(1_700_000_000 - 365 * 24 * 60 * 60));
  assert.equal(first.searchParams.get("per_page"), "200");
  assert.equal(first.searchParams.get("page"), "1");
  assert.equal(new URL(requested[1]!).searchParams.get("page"), "2");
});

test("deauthorizeStravaAccess posts refresh token to /oauth/revoke with Basic auth", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fetchImpl = mockFetch(async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return new Response(null, { status: 200 });
  });
  await deauthorizeStravaAccess(baseConfig(fetchImpl), {
    accessToken: "access-x",
    refreshToken: "refresh-x"
  });
  assert.equal(seenUrl, "https://www.strava.com/oauth/revoke");
  assert.equal(seenInit?.method, "POST");
  const headers = seenInit?.headers as Record<string, string>;
  const expectedBasic = Buffer.from("cid:csecret").toString("base64");
  assert.equal(headers.Authorization, `Basic ${expectedBasic}`);
  assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = String(seenInit?.body ?? "");
  assert.match(body, /token=refresh-x/);
  assert.match(body, /token_type_hint=refresh_token/);
});

test("deauthorizeStravaAccess throws on non-OK status", async () => {
  const fetchImpl = mockFetch(async () => new Response("nope", { status: 401 }));
  await assert.rejects(
    () =>
      deauthorizeStravaAccess(baseConfig(fetchImpl), {
        accessToken: "a",
        refreshToken: "r"
      }),
    (err: unknown) =>
      err instanceof Error &&
      err.name === "StravaClientError" &&
      (err as { code?: string }).code === "strava_deauthorize_http"
  );
});
