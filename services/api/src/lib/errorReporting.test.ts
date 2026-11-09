import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";
import {
  initErrorReporting,
  installProcessHandlers,
  isErrorReportingEnabled,
  registerErrorReporting,
  resetErrorReportingForTests,
  shouldReport
} from "./errorReporting.js";
import { scrubBreadcrumb, scrubEvent, scrubString } from "./errorScrub.js";

const FAKE_DSN = "https://public@o0.ingest.sentry.io/0";

/** Collects the raw envelopes Sentry would send, instead of sending them. */
function captureTransport() {
  const bodies: string[] = [];
  const transport = (options: Parameters<typeof Sentry.createTransport>[0]) =>
    Sentry.createTransport(options, async (request) => {
      bodies.push(typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body));
      return { statusCode: 200 };
    });
  return { bodies, transport };
}

test("EC1: no DSN leaves Sentry off", async () => {
  await resetErrorReportingForTests();
  assert.equal(initErrorReporting({}), false);
  assert.equal(initErrorReporting({ SENTRY_DSN: "   " }), false);
  assert.equal(isErrorReportingEnabled(), false);
  assert.equal(Sentry.isInitialized(), false);
});

test("EC2: a malformed DSN does not throw and stays off", async () => {
  await resetErrorReportingForTests();
  assert.doesNotThrow(() => initErrorReporting({ SENTRY_DSN: "not a dsn" }));
  assert.equal(isErrorReportingEnabled(), false);
  await resetErrorReportingForTests();
});

test("EC3: only server faults are reported", () => {
  assert.equal(shouldReport(undefined), true);
  assert.equal(shouldReport(500), true);
  assert.equal(shouldReport(503), true);
  assert.equal(shouldReport(400), false);
  assert.equal(shouldReport(401), false);
  assert.equal(shouldReport(403), false);
  assert.equal(shouldReport(404), false);
});

test("EC3/EC7: Fastify 5xx is sent scrubbed, 4xx is not sent", async () => {
  await resetErrorReportingForTests();
  const { bodies, transport } = captureTransport();
  assert.equal(initErrorReporting({ SENTRY_DSN: FAKE_DSN, SENTRY_ENVIRONMENT: "test" }, { transport }), true);

  const app = Fastify();
  registerErrorReporting(app);
  app.get("/boom", async () => {
    throw new Error("db failed for runner@example.com at 39.7392,-104.9903");
  });
  app.get("/denied", async () => {
    const error = new Error("nope") as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  });

  const boom = await app.inject({
    method: "GET",
    url: "/boom?code=oauth-secret&lat=39.7392",
    headers: { authorization: "Bearer abc.def.ghi", cookie: "sid=1" }
  });
  assert.equal(boom.statusCode, 500);
  const denied = await app.inject({ method: "GET", url: "/denied" });
  assert.equal(denied.statusCode, 403);

  await Sentry.flush(2000);
  await app.close();
  const sent = bodies.join("\n");
  assert.equal(bodies.length, 1, "exactly one event (the 500)");
  assert.match(sent, /db failed for/);
  assert.doesNotMatch(sent, /runner@example\.com/);
  assert.doesNotMatch(sent, /39\.7392/);
  assert.doesNotMatch(sent, /oauth-secret/);
  assert.doesNotMatch(sent, /abc\.def\.ghi/);
  assert.doesNotMatch(sent, /sid=1/);
  await resetErrorReportingForTests();
});

test("EC5: init twice keeps one client; handlers install once per target", async () => {
  await resetErrorReportingForTests();
  const { transport } = captureTransport();
  assert.equal(initErrorReporting({ SENTRY_DSN: FAKE_DSN }, { transport }), true);
  const client = Sentry.getClient();
  assert.equal(initErrorReporting({ SENTRY_DSN: FAKE_DSN }, { transport }), true);
  assert.equal(Sentry.getClient(), client);
  await resetErrorReportingForTests();

  const target = new EventEmitter();
  installProcessHandlers(() => {}, () => {}, target);
  installProcessHandlers(() => {}, () => {}, target);
  assert.equal(target.listenerCount("uncaughtException"), 1);
  assert.equal(target.listenerCount("unhandledRejection"), 1);
});

test("process handlers log, report and exit 1 once", async () => {
  await resetErrorReportingForTests();
  const { bodies, transport } = captureTransport();
  initErrorReporting({ SENTRY_DSN: FAKE_DSN }, { transport });

  const target = new EventEmitter();
  const logged: string[] = [];
  const exits: number[] = [];
  let exited: () => void = () => {};
  const done = new Promise<void>((resolve) => (exited = resolve));
  installProcessHandlers(
    (message) => logged.push(message),
    (code) => {
      exits.push(code);
      exited();
    },
    target
  );
  target.emit("unhandledRejection", new Error("lost promise"));
  target.emit("uncaughtException", new Error("second fault"));
  await done;

  assert.deepEqual(logged, ["fatal: unhandledRejection", "fatal: uncaughtException"]);
  assert.deepEqual(exits, [1]);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], /lost promise/);
  await resetErrorReportingForTests();
});

test("process handlers exit 1 with reporting off", async () => {
  await resetErrorReportingForTests();
  const target = new EventEmitter();
  const exits: number[] = [];
  let exited: () => void = () => {};
  const done = new Promise<void>((resolve) => (exited = resolve));
  installProcessHandlers(
    () => {},
    (code) => {
      exits.push(code);
      exited();
    },
    target
  );
  target.emit("uncaughtException", new Error("boom"));
  await done;
  assert.deepEqual(exits, [1]);
});

test("EC7: scrubString removes tokens, emails, lat/lng pairs and queries", () => {
  assert.equal(scrubString("Bearer eyJhbGciOi.abc.def"), "Bearer [Filtered]");
  assert.equal(scrubString("jwt eyJhbGciOiJI.eyJzdWIiOiIx.sig"), "jwt [Filtered]");
  assert.equal(scrubString("mail a.b+c@example.co.uk now"), "mail [Filtered] now");
  assert.equal(scrubString("at 39.739236, -104.990251"), "at [Filtered]");
  assert.equal(scrubString("GET /strava/oauth/redirect?code=x&state=y"), "GET /strava/oauth/redirect");
  assert.equal(scrubString("mile 12.5 of 100"), "mile 12.5 of 100");
});

test("EC7: scrubEvent drops request body, identity, sensitive keys and headers", () => {
  const event = {
    type: undefined,
    message: "token for x@y.io",
    user: { id: "auth0|123", email: "x@y.io", ip_address: "1.2.3.4" },
    server_name: "railway-host",
    request: {
      url: "https://api.example.com/race-rooms/r1/pings?token=t",
      query_string: "token=t",
      cookies: { sid: "1" },
      data: { lat: 39.7, lng: -104.9 },
      headers: {
        authorization: "Bearer t",
        cookie: "sid=1",
        "x-crewcue-chat-push-secret": "s",
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "CrewCue/1"
      }
    },
    extra: { accessToken: "t", ping: { lat: 39.7, lng: -104.9, mile: 12 }, Email: "x@y.io" },
    contexts: { device: { latitude: 1, longitude: 2, model: "iPhone" } },
    breadcrumbs: [{ category: "http", data: { url: "/geocode?q=home", "http.query": "q=home" } }]
  } as unknown as ErrorEvent;

  const out = scrubEvent(event);
  assert.equal(out.user, undefined);
  assert.equal(out.server_name, undefined);
  assert.equal(out.message, "token for [Filtered]");
  assert.equal(out.request?.url, "https://api.example.com/race-rooms/r1/pings");
  assert.equal(out.request?.query_string, undefined);
  assert.equal(out.request?.cookies, undefined);
  assert.equal(out.request?.data, undefined);
  assert.deepEqual(out.request?.headers, { "user-agent": "CrewCue/1" });
  assert.deepEqual(out.extra, {
    accessToken: "[Filtered]",
    ping: { lat: "[Filtered]", lng: "[Filtered]", mile: 12 },
    Email: "[Filtered]"
  });
  assert.deepEqual(out.contexts, { device: { latitude: "[Filtered]", longitude: "[Filtered]", model: "iPhone" } });
  assert.deepEqual(out.breadcrumbs?.[0]?.data, { url: "/geocode" });
});

test("EC7: scrubBreadcrumb strips query and coordinate data", () => {
  const crumb = scrubBreadcrumb({
    category: "http",
    message: "GET /race-rooms/r1/geocode/search?q=Main",
    data: { url: "https://maps.example/x?key=k", method: "GET", coords: [1, 2], status_code: 200 }
  });
  assert.equal(crumb.message, "GET /race-rooms/r1/geocode/search");
  assert.deepEqual(crumb.data, { url: "https://maps.example/x", method: "GET", coords: "[Filtered]", status_code: 200 });
});
