import * as Sentry from "@sentry/node";
import type { FastifyInstance } from "fastify";
import { scrubBreadcrumb, scrubEvent } from "./errorScrub.js";

/**
 * Sentry error tracking (Developer plan, ADR 0010). Off unless `SENTRY_DSN` is set, so local dev,
 * tests and CI never send anything. Errors only: no tracing, profiling or replay.
 */

const FLUSH_TIMEOUT_MS = 2000;

let enabled = false;
const handlersInstalledOn = new WeakSet<object>();

export type ErrorReportingEnv = Partial<
  Record<"SENTRY_DSN" | "SENTRY_ENVIRONMENT" | "RAILWAY_ENVIRONMENT_NAME" | "NODE_ENV" | "RAILWAY_GIT_COMMIT_SHA", string>
>;

/** Starts Sentry when a DSN is configured. Returns whether reporting is on. Safe to call twice. */
export function initErrorReporting(
  env: ErrorReportingEnv = process.env,
  testOptions: Pick<Sentry.NodeOptions, "transport"> = {}
): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || enabled) return enabled;
  try {
    Sentry.init({
      dsn,
      environment: env.SENTRY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "development",
      release: env.RAILWAY_GIT_COMMIT_SHA || undefined,
      // Collect nothing about the user or request payloads; scrubEvent is the second line.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: { allow: ["user-agent", "content-type", "accept"] }, response: false },
        httpBodies: [],
        urlQueryParams: false
      },
      // Errors only. Our own process handlers (below) report and exit, so drop Sentry's copies.
      integrations: (defaults) =>
        defaults.filter((i) => i.name !== "OnUncaughtException" && i.name !== "OnUnhandledRejection"),
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      ...testOptions
    });
    enabled = Sentry.isEnabled();
  } catch (error) {
    console.error("error reporting disabled: Sentry init failed", error);
    enabled = false;
  }
  return enabled;
}

export function isErrorReportingEnabled(): boolean {
  return enabled;
}

/** Only server faults go to Sentry. Auth, validation and not-found errors are expected traffic. */
export function shouldReport(statusCode: number | undefined): boolean {
  return statusCode === undefined || statusCode >= 500;
}

export function captureError(error: unknown): void {
  if (enabled) Sentry.captureException(error);
}

export async function flushErrorReporting(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}

/** Reports 5xx request errors. Registered in `buildApp`; a no-op when reporting is off. */
export function registerErrorReporting(app: FastifyInstance): void {
  app.addHook("onError", async (_request, _reply, error) => {
    if (enabled && shouldReport((error as { statusCode?: number }).statusCode)) {
      Sentry.captureException(error);
    }
  });
}

type FatalLogger = (message: string, error: unknown) => void;

/**
 * Process-level crash handlers: log, report, flush, exit 1. A process in an unknown state must
 * not keep serving; Railway restarts it. Installed once even if called again.
 */
export function installProcessHandlers(
  log: FatalLogger = (message, error) => console.error(message, error),
  exit: (code: number) => void = (code) => process.exit(code),
  target: Pick<NodeJS.EventEmitter, "on"> = process
): void {
  if (handlersInstalledOn.has(target)) return;
  handlersInstalledOn.add(target);
  let exiting = false;
  const fatal = (kind: string) => (error: unknown) => {
    log(`fatal: ${kind}`, error);
    if (exiting) return;
    exiting = true;
    captureError(error);
    void flushErrorReporting().finally(() => exit(1));
  };
  target.on("uncaughtException", fatal("uncaughtException"));
  target.on("unhandledRejection", fatal("unhandledRejection"));
}

/** Test hook: shut Sentry down and forget init state. Does not remove process listeners. */
export async function resetErrorReportingForTests(): Promise<void> {
  if (enabled) await Sentry.close(0);
  enabled = false;
}
