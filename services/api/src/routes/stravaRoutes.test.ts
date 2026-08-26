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
  options?: { configureStrava?: boolean }
): Promise<void> {
  await resetActivityHistoryStoreForTests();
  await resetStravaConnectionStoreForTests();
  setStravaClientConfigForTests(undefined);

  if (options?.configureStrava !== false) {
    setStravaClientConfigForTests({
      clientId: "test-client",
      clientSecret: "test-secret",
      redirectUri: "crewcue://strava",
      fetchImpl: mockFetch(async (url) => {
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
        if (url.includes("/athlete/activities")) {
          return new Response(JSON.stringify([fixtureSummary]), { status: 200 });
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

test("oauth redirect renders a public completion page for Strava browser fallback", async () => {
  await withApp(async ({ app }) => {
    const response = await app.inject({
      method: "GET",
      url: "/strava/oauth/redirect?code=auth-code&state=state-1"
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    assert.match(response.body, /Strava authorization complete/);
    assert.match(response.body, /Return to CrewCue to finish connecting/);
  });
});

test("oauth redirect escapes provider error text before rendering HTML", async () => {
  await withApp(async ({ app }) => {
    const response = await app.inject({
      method: "GET",
      url:
        "/strava/oauth/redirect?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E%20%26%20%22no%22"
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    assert.doesNotMatch(response.body, /<script>/);
    assert.match(response.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;no&quot;/);
    assert.match(response.body, /Return to CrewCue and try again/);
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
