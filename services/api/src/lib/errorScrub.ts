import type { Breadcrumb, ErrorEvent } from "@sentry/node";
import { logSafeUrl } from "./logSafeUrl.js";

/**
 * Strips credentials and personal data from Sentry events before they leave the server.
 * Same rules as the request logger (`app.ts` + `logSafeUrl`): no query strings, no auth or
 * cookie headers. On top of that: no request bodies, no tokens, emails or precise lat/lng.
 */

const FILTERED = "[Filtered]";

/** Object keys whose values never go to Sentry. Matched against the whole key, case-insensitive. */
const SENSITIVE_KEY =
  /^(?:.*(?:token|secret|password|passwd|authorization|cookie|api[-_]?key|session|jwt|bearer|dsn|email)|lat|lng|lon|latitude|longitude|coords?|coordinates?|position|location|accuracy|altitude|ip|ip_address)$/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
/** Two decimals with 3+ fractional digits separated by a comma: a lat/lng pair. */
const LAT_LNG_PAIR = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g;
const QUERY = /(\/[^\s?"']*)\?[^\s"']*/g;

const MAX_DEPTH = 8;

export function scrubString(value: string): string {
  return value
    .replace(BEARER, `Bearer ${FILTERED}`)
    .replace(JWT, FILTERED)
    .replace(EMAIL, FILTERED)
    .replace(LAT_LNG_PAIR, FILTERED)
    .replace(QUERY, "$1");
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return FILTERED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? FILTERED : scrubValue(inner, depth + 1);
  }
  return out;
}

function scrubRecord<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : (scrubValue(value) as T);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const request = event.request;
    if (request.url) request.url = logSafeUrl(request.url);
    delete request.query_string;
    delete request.cookies;
    delete request.data;
    delete request.env;
    if (request.headers) {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (!SENSITIVE_KEY.test(name) && !/^x-crewcue-|^x-forwarded-for$|^x-real-ip$/i.test(name)) {
          headers[name] = value;
        }
      }
      request.headers = headers;
    }
  }
  // Never send who the user is: crash data stays unlinked from identity.
  delete event.user;
  delete event.server_name;
  if (event.message) event.message = scrubString(event.message);
  if (event.transaction) event.transaction = logSafeUrl(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.vars) frame.vars = scrubRecord(frame.vars);
      if (frame.context_line) frame.context_line = scrubString(frame.context_line);
      if (frame.pre_context) frame.pre_context = frame.pre_context.map(scrubString);
      if (frame.post_context) frame.post_context = frame.post_context.map(scrubString);
    }
  }
  event.extra = scrubRecord(event.extra);
  event.contexts = scrubRecord(event.contexts);
  event.tags = scrubRecord(event.tags);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb));
  }
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = { ...crumb };
  if (out.message) out.message = scrubString(out.message);
  if (out.data) {
    const data = scrubValue(out.data) as Record<string, unknown>;
    if (typeof data.url === "string") data.url = logSafeUrl(data.url);
    delete data["http.query"];
    delete data["http.fragment"];
    out.data = data;
  }
  return out;
}
