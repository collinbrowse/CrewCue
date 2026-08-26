/**
 * Strava OAuth + activity sync routes (W3-2).
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActivityHistoryRef } from "@crewcue/contracts";
import {
  initActivityHistoryStore,
  upsertActivityHistory
} from "../lib/activityHistoryStore.js";
import {
  mapStravaActivityToHistoryRef,
  type StravaActivitySummary
} from "../lib/strava/mapStravaActivity.js";
import {
  buildStravaAuthorizeUrl,
  exchangeStravaAuthorizationCode,
  ensureFreshStravaAccessToken,
  listStravaAthleteActivities,
  readStravaEnvConfig,
  StravaClientError,
  type StravaClientConfig
} from "../lib/strava/stravaClient.js";
import {
  consumeOAuthPendingState,
  deleteStravaConnection,
  getStravaConnection,
  getStravaConnectionPublic,
  initStravaConnectionStore,
  saveOAuthPendingState,
  upsertStravaConnection
} from "../lib/stravaConnectionStore.js";

const callbackBody = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1)
  })
  .strict();

/** Bounce Strava HTTPS callback into the app so ASWebAuthenticationSession auto-dismisses. */
const STRAVA_APP_REDIRECT_URI = "crewcue://strava";

function buildStravaAppRedirectUrl(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) {
      search.set(key, trimmed);
    }
  }
  const query = search.toString();
  return query.length > 0 ? `${STRAVA_APP_REDIRECT_URI}?${query}` : STRAVA_APP_REDIRECT_URI;
}

/** Injectable Strava config + fetch for tests. */
let testConfigOverride: StravaClientConfig | undefined;

export function setStravaClientConfigForTests(config: StravaClientConfig | undefined): void {
  testConfigOverride = config;
}

function resolveConfig(): StravaClientConfig | undefined {
  return testConfigOverride ?? readStravaEnvConfig();
}

function isStravaActivitySummary(value: unknown): value is StravaActivitySummary {
  if (!value || typeof value !== "object") return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === "number" || typeof id === "string";
}

export async function stravaRoutes(app: FastifyInstance): Promise<void> {
  await initStravaConnectionStore(app.log);
  await initActivityHistoryStore(app.log);

  app.get("/strava/oauth/start", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const config = resolveConfig();
    if (!config) {
      return reply.code(503).send({
        error: "Strava OAuth is not configured",
        code: "strava_not_configured"
      });
    }
    const state = randomBytes(24).toString("hex");
    await saveOAuthPendingState(state, request.identity.sub);
    const authorizeUrl = buildStravaAuthorizeUrl(config, state);
    return reply.code(200).send({
      authorizeUrl,
      state,
      /** Must match `openAuthSessionAsync` redirect on mobile and Strava app settings. */
      redirectUri: config.redirectUri
    });
  });

  /**
   * Strava redirects here after consent (HTTPS callback domain).
   * Immediately bounces to `crewcue://strava` so mobile auth session auto-closes on iOS.
   */
  app.get("/strava/oauth/redirect", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (query.error) {
      return reply.redirect(
        buildStravaAppRedirectUrl({
          error: query.error,
          error_description: query.error_description
        })
      );
    }
    const code = query.code?.trim();
    const state = query.state?.trim();
    if (code && state) {
      return reply.redirect(buildStravaAppRedirectUrl({ code, state }));
    }
    return reply
      .type("text/html")
      .code(400)
      .send(
        `<!doctype html><html><body><p>Strava callback was missing code or state.</p><p>Return to CrewCue and try Connect again.</p></body></html>`
      );
  });

  app.post("/strava/oauth/callback", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const config = resolveConfig();
    if (!config) {
      return reply.code(503).send({
        error: "Strava OAuth is not configured",
        code: "strava_not_configured"
      });
    }
    const parsed = callbackBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid Strava OAuth callback payload" });
    }
    const ok = await consumeOAuthPendingState(parsed.data.state, request.identity.sub);
    if (!ok) {
      return reply.code(400).send({
        error: "Invalid or expired OAuth state",
        code: "strava_oauth_state_invalid"
      });
    }
    try {
      const tokens = await exchangeStravaAuthorizationCode(config, parsed.data.code);
      await upsertStravaConnection(request.identity.sub, tokens);
      return reply.code(200).send({
        connected: true,
        athleteId: tokens.athleteId
      });
    } catch (err) {
      if (err instanceof StravaClientError) {
        return reply.code(502).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.get("/strava/connection", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const status = await getStravaConnectionPublic(request.identity.sub);
    return reply.code(200).send(status);
  });

  app.post("/strava/sync", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const config = resolveConfig();
    if (!config) {
      return reply.code(503).send({
        error: "Strava OAuth is not configured",
        code: "strava_not_configured"
      });
    }
    const existing = await getStravaConnection(request.identity.sub);
    if (!existing) {
      return reply.code(409).send({
        error: "Strava is not connected",
        code: "strava_not_connected"
      });
    }

    try {
      const { tokens, refreshed } = await ensureFreshStravaAccessToken(config, existing);
      if (refreshed) {
        await upsertStravaConnection(request.identity.sub, tokens);
      }
      const activities = await listStravaAthleteActivities(config, tokens.accessToken, {
        page: 1,
        perPage: 30
      });
      const refs: ActivityHistoryRef[] = [];
      let createdCount = 0;
      for (const item of activities) {
        if (!isStravaActivitySummary(item)) continue;
        try {
          const mapped = mapStravaActivityToHistoryRef(item);
          const result = await upsertActivityHistory(request.identity.sub, mapped);
          refs.push(result.ref);
          if (result.created) createdCount += 1;
        } catch {
          // Skip malformed activity rows; continue syncing the rest.
        }
      }
      return reply.code(200).send({
        syncedCount: refs.length,
        createdCount,
        items: refs
      });
    } catch (err) {
      if (err instanceof StravaClientError) {
        return reply.code(502).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.delete("/strava/connection", async (request, reply) => {
    if (!request.identity) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    await deleteStravaConnection(request.identity.sub);
    return reply.code(200).send({ connected: false });
  });
}
