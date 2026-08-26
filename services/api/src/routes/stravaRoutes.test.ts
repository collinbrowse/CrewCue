import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseActivityHistoryRef, type ActivityHistoryRef } from "@crewcue/contracts";
import { buildApp } from "../app.js";
import {
  countActivityHistoryRows,
  resetActivityHistoryStoreForTests
} from "../lib/activityHistoryStore.js";
import { resetStravaConnectionStoreForTests } from "../lib/stravaConnectionStore.js";
import { setStravaClientConfigForTests } from "./stravaRoutes.js";

function findPacingFixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, "fixtures/pacing");
    if (existsSync(resolve(candidate, "strava-activity-summary.json"))) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  throw new Error("fixtures/pacing not found");
}

const fixtureSummary = JSON.parse(
  readFileSync(resolve(findPacingFixturesDir(), "strava-activity-summary.json"), "utf8")
) as Record<string, unknown>;

function buildClaims(sub: string) {
  return {
    sub,
    teamIds: ["team-1"],
    roomRoles: {}
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

async function withApp(
  run: (ctx: {
    app: ReturnType<typeof buildApp>;
    tokenFor: (sub: string) => string;
  }) => Promise<void>,
  options?: {
    configureStrava?: boolean;
    activities?: unknown[];
    fetchOverride?: typeof fetch;
  }
): Promise<void> {
  await resetActivityHistoryStoreForTests();
  await resetStravaConnectionStoreForTests();
  setStravaClientConfigForTests(undefined);

  if (options?.configureStrava !== false) {
    setStravaClientConfigForTests({
      clientId: "test-client",
      clientSecret: "test-secret",
      redirectUri: "crewcue://strava",
      fetchImpl:
        options?.fetchOverride ??
        mockFetch(async (url) => {
          if (url.includes("/oauth/token")) {
            return new Response(
              JSON.stringify({
                access_token: "access-1",
                refresh_token: "refresh-1",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                athlete: { id: 4242 }
              }),
              { status: 200 }
            );
          }
          if (url.includes("/oauth/revoke") || url.includes("/oauth/deauthorize")) {
            return new Response(null, { status: 200 });
          }
          if (url.includes("/athlete/activities")) {
            const payload = options?.activities ?? [fixtureSummary];
            return new Response(JSON.stringify(payload), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        })
    });
  }

  const app = buildApp();
  await app.ready();
  try {
    await run({
      app,
      tokenFor: (sub) => app.jwt.sign(buildClaims(sub))
    });
  } finally {
    await app.close();
    setStravaClientConfigForTests(undefined);
    await resetActivityHistoryStoreForTests();
    await resetStravaConnectionStoreForTests();
  }
}

test("EC3: Strava routes require auth", async () => {
  await withApp(async ({ app }) => {
    for (const [method, url] of [
      ["GET", "/strava/oauth/start"],
      ["POST", "/strava/oauth/callback"],
      ["GET", "/strava/connection"],
      ["POST", "/strava/sync"],
      ["DELETE", "/strava/connection"]
    ] as const) {
      const response = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
  });
});

test("oauth redirect bounces success to crewcue deep link", async () => {
  await withApp(async ({ app }) => {
    const response = await app.inject({
      method: "GET",
      url: "/strava/oauth/redirect?code=auth-code&state=state-1"
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "crewcue://strava?code=auth-code&state=state-1");
  });
});

test("oauth redirect bounces provider error to deep link without raw HTML", async () => {
  await withApp(async ({ app }) => {
    const response = await app.inject({
      method: "GET",
      url:
        "/strava/oauth/redirect?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E%20%26%20%22no%22"
    });

    assert.equal(response.statusCode, 302);
    const location = String(response.headers.location ?? "");
    assert.match(location, /^crewcue:\/\/strava\?/);
    assert.match(location, /error=access_denied/);
    assert.doesNotMatch(location, /<script>/);
    assert.match(location, /error_description=/);
  });
});

test("oauth redirect returns HTML 400 when code or state is missing", async () => {
  await withApp(async ({ app }) => {
    const response = await app.inject({
      method: "GET",
      url: "/strava/oauth/redirect?code=only-code"
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    assert.match(response.body, /missing code or state/i);
  });
});

test("EC2: callback with missing/invalid state returns 400", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const missing = await app.inject({
      method: "POST",
      url: "/strava/oauth/callback",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: "x" }
    });
    assert.equal(missing.statusCode, 400);

    const invalid = await app.inject({
      method: "POST",
      url: "/strava/oauth/callback",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: "x", state: "not-a-real-state" }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal((invalid.json() as { code?: string }).code, "strava_oauth_state_invalid");
  });
});

test("EC4: sync without connection returns 409", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");
    const response = await app.inject({
      method: "POST",
      url: "/strava/sync",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(response.statusCode, 409);
    assert.equal((response.json() as { code?: string }).code, "strava_not_connected");
  });
});

test("oauth start → callback → sync → idempotent re-sync (EC5) → disconnect keeps history (EC7)", async () => {
  await withApp(async ({ app, tokenFor }) => {
    const token = tokenFor("athlete-1");

    const start = await app.inject({
      method: "GET",
      url: "/strava/oauth/start",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(start.statusCode, 200);
    const startBody = start.json() as { authorizeUrl: string; state: string; redirectUri: string };
    assert.match(startBody.authorizeUrl, /strava\.com\/oauth\/authorize/);
    assert.ok(startBody.state.length > 8);
    assert.equal(startBody.redirectUri, "crewcue://strava");

    const callback = await app.inject({
      method: "POST",
      url: "/strava/oauth/callback",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: "auth-code", state: startBody.state }
    });
    assert.equal(callback.statusCode, 200);
    assert.deepEqual(callback.json(), { connected: true, athleteId: "4242" });

    const connection = await app.inject({
      method: "GET",
      url: "/strava/connection",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(connection.statusCode, 200);
    assert.deepEqual(connection.json(), { connected: true, athleteId: "4242" });

    const sync1 = await app.inject({
      method: "POST",
      url: "/strava/sync",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(sync1.statusCode, 200);
    const sync1Body = sync1.json() as {
      syncedCount: number;
      createdCount: number;
      items: ActivityHistoryRef[];
    };
    assert.equal(sync1Body.syncedCount, 1);
    assert.equal(sync1Body.createdCount, 1);
    const ref = parseActivityHistoryRef(sync1Body.items[0]);
    assert.equal(ref.source, "strava");
    assert.equal(ref.externalId, `strava:${fixtureSummary.id}`);
    assert.equal(await countActivityHistoryRows(), 1);

    const sync2 = await app.inject({
      method: "POST",
      url: "/strava/sync",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(sync2.statusCode, 200);
    const sync2Body = sync2.json() as { syncedCount: number; createdCount: number };
    assert.equal(sync2Body.syncedCount, 1);
    assert.equal(sync2Body.createdCount, 0);
    assert.equal(await countActivityHistoryRows(), 1);

    const list = await app.inject({
      method: "GET",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(list.statusCode, 200);
    assert.equal((list.json() as { items: unknown[] }).items.length, 1);

    const disconnect = await app.inject({
      method: "DELETE",
      url: "/strava/connection",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(disconnect.statusCode, 200);
    assert.deepEqual(disconnect.json(), { connected: false });

    const after = await app.inject({
      method: "GET",
      url: "/strava/connection",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.deepEqual(after.json(), { connected: false });

    const historyAfter = await app.inject({
      method: "GET",
      url: "/activity-history",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal((historyAfter.json() as { items: unknown[] }).items.length, 1);
  });
});

test("sync skips non-run Strava sports so rides cannot poison pacing history", async () => {
  const ride = {
    id: 111,
    distance: 40_000,
    elapsed_time: 4800,
    moving_time: 4700,
    total_elevation_gain: 200,
    type: "Ride",
    sport_type: "Ride",
    start_date: "2026-05-11T15:00:00Z"
  };
  const swim = {
    id: 222,
    distance: 2500,
    elapsed_time: 2700,
    type: "Swim",
    sport_type: "Swim",
    start_date: "2026-05-12T15:00:00Z"
  };
  const shortRun = {
    id: 333,
    distance: 800,
    elapsed_time: 300,
    type: "Run",
    sport_type: "Run",
    start_date: "2026-05-13T15:00:00Z"
  };
  const longRun = {
    id: 444,
    distance: 75_000,
    elapsed_time: 27_000,
    type: "TrailRun",
    sport_type: "TrailRun",
    start_date: "2026-05-14T15:00:00Z"
  };
  await withApp(
    async ({ app, tokenFor }) => {
      const token = tokenFor("athlete-mixed");
      const start = await app.inject({
        method: "GET",
        url: "/strava/oauth/start",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(start.statusCode, 200);
      const startBody = start.json() as { state: string };
      const callback = await app.inject({
        method: "POST",
        url: "/strava/oauth/callback",
        headers: { authorization: `Bearer ${token}` },
        payload: { code: "auth-code", state: startBody.state }
      });
      assert.equal(callback.statusCode, 200);

      const sync = await app.inject({
        method: "POST",
        url: "/strava/sync",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(sync.statusCode, 200);
      const body = sync.json() as { syncedCount: number; createdCount: number; items: ActivityHistoryRef[] };
      assert.equal(body.syncedCount, 3);
      assert.equal(body.createdCount, 3);
      const externalIds = new Set(body.items.map((item) => item.externalId));
      assert.equal(externalIds.has(`strava:${fixtureSummary.id}`), true);
      assert.equal(externalIds.has("strava:333"), true);
      assert.equal(externalIds.has("strava:444"), true);
      assert.equal(externalIds.has("strava:111"), false);
      assert.equal(await countActivityHistoryRows(), 3);
    },
    { activities: [ride, fixtureSummary, swim, shortRun, longRun] }
  );
});

test("disconnect calls Strava revoke then clears local connection even if revoke fails", async () => {
  let revokeCalls = 0;
  await withApp(
    async ({ app, tokenFor }) => {
      const token = tokenFor("athlete-revoke");
      const start = await app.inject({
        method: "GET",
        url: "/strava/oauth/start",
        headers: { authorization: `Bearer ${token}` }
      });
      const startBody = start.json() as { state: string };
      const callback = await app.inject({
        method: "POST",
        url: "/strava/oauth/callback",
        headers: { authorization: `Bearer ${token}` },
        payload: { code: "auth-code", state: startBody.state }
      });
      assert.equal(callback.statusCode, 200);

      const disconnect = await app.inject({
        method: "DELETE",
        url: "/strava/connection",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(disconnect.statusCode, 200);
      assert.deepEqual(disconnect.json(), { connected: false });
      assert.equal(revokeCalls, 1);

      const after = await app.inject({
        method: "GET",
        url: "/strava/connection",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.deepEqual(after.json(), { connected: false });
    },
    {
      fetchOverride: mockFetch(async (url) => {
        if (url.includes("/oauth/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-1",
              refresh_token: "refresh-1",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              athlete: { id: 99 }
            }),
            { status: 200 }
          );
        }
        if (url.includes("/oauth/revoke")) {
          revokeCalls += 1;
          return new Response("unauthorized", { status: 401 });
        }
        return new Response("not found", { status: 404 });
      })
    }
  );
});

test("oauth start returns 503 when Strava is not configured", async () => {
  await withApp(
    async ({ app, tokenFor }) => {
      const response = await app.inject({
        method: "GET",
        url: "/strava/oauth/start",
        headers: { authorization: `Bearer ${tokenFor("athlete-1")}` }
      });
      assert.equal(response.statusCode, 503);
      assert.equal((response.json() as { code?: string }).code, "strava_not_configured");
    },
    { configureStrava: false }
  );
});
