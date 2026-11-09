/**
 * Direct push transports for crew chat (ADR 0011, issue #563).
 *
 * - APNs: HTTP/2 with a token-based (.p8) provider JWT, ES256, refreshed every 50 minutes.
 * - FCM HTTP v1: OAuth access token from a service account (JWT bearer grant), RS256.
 *
 * Both retry 429/5xx twice with backoff and report tokens the provider says are dead
 * (`invalidDeviceIds`) so the caller can delete them. Network calls are injectable for tests.
 */
import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import type {
  ChatPushDeliveryTarget,
  ChatPushDispatchInput,
  ChatPushDispatchResult,
  ChatPushTransport
} from "./chatPushDispatch.js";

const RETRY_DELAYS_MS = [200, 800];

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function emptyResult(): ChatPushDispatchResult {
  return { delivered: 0, attempts: 0, failures: [], invalidDeviceIds: [] };
}

function mergeResults(results: ChatPushDispatchResult[]): ChatPushDispatchResult {
  const out = emptyResult();
  for (const r of results) {
    out.delivered += r.delivered;
    out.attempts += r.attempts;
    out.failures.push(...r.failures);
    out.invalidDeviceIds.push(...r.invalidDeviceIds);
  }
  return out;
}

/** Accepts raw PEM, PEM with literal "\n", or base64 of either. */
export function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  const unescaped = trimmed.replace(/\\n/g, "\n");
  if (unescaped.includes("-----BEGIN")) return unescaped;
  return Buffer.from(trimmed, "base64").toString("utf8").replace(/\\n/g, "\n");
}

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

export type ApnsConfig = {
  keyP8: string;
  keyId: string;
  teamId: string;
  /** App bundle id (apns-topic). */
  topic: string;
};

export type ApnsResponse = { status: number; body: string };
export type ApnsRequest = (args: {
  origin: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<ApnsResponse>;

export const APNS_PRODUCTION_ORIGIN = "https://api.push.apple.com";
export const APNS_DEVELOPMENT_ORIGIN = "https://api.sandbox.push.apple.com";

export function readApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | undefined {
  const keyP8 = env.APNS_KEY_P8?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const topic = env.APNS_TOPIC?.trim();
  if (!keyP8 || !keyId || !teamId || !topic) return undefined;
  return { keyP8: normalizePem(keyP8), keyId, teamId, topic };
}

const http2Sessions = new Map<string, http2.ClientHttp2Session>();

/** Default APNs request over a cached HTTP/2 session per origin. */
export const http2ApnsRequest: ApnsRequest = ({ origin, path, headers, body }) =>
  new Promise((resolve, reject) => {
    let session = http2Sessions.get(origin);
    if (!session || session.closed || session.destroyed) {
      session = http2.connect(origin);
      session.on("error", () => http2Sessions.delete(origin));
      session.on("close", () => http2Sessions.delete(origin));
      session.unref();
      http2Sessions.set(origin, session);
    }
    const req = session.request({ ":method": "POST", ":path": path, ...headers });
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.on("response", (h) => {
      status = Number(h[":status"] ?? 0);
    });
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("end", () => resolve({ status, body: data }));
    req.on("error", reject);
    req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.end(body);
  });

function apnsReason(body: string): string {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? "";
  } catch {
    return "";
  }
}

const APNS_DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export function apnsTransport(
  config: ApnsConfig,
  request: ApnsRequest = http2ApnsRequest,
  opts: { sleep?: Sleep; now?: () => number } = {}
): ChatPushTransport {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  let cached: { jwt: string; issuedAt: number } | undefined;

  async function providerToken(force = false): Promise<string> {
    if (!force && cached && now() - cached.issuedAt < 50 * 60 * 1000) return cached.jwt;
    const key = await importPKCS8(config.keyP8, "ES256");
    const issuedAt = now();
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: config.keyId })
      .setIssuer(config.teamId)
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .sign(key);
    cached = { jwt, issuedAt };
    return jwt;
  }

  async function sendOne(input: ChatPushDispatchInput, target: ChatPushDeliveryTarget): Promise<ChatPushDispatchResult> {
    const result = emptyResult();
    const origin = target.apnsEnvironment === "development" ? APNS_DEVELOPMENT_ORIGIN : APNS_PRODUCTION_ORIGIN;
    const body = JSON.stringify({
      aps: {
        alert: { title: input.title, body: input.body },
        sound: "default",
        "thread-id": input.roomId
      },
      type: input.kind ?? "chat",
      roomId: input.roomId,
      ...(input.messageId ? { messageId: input.messageId } : {})
    });
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      result.attempts += 1;
      let response: ApnsResponse;
      try {
        response = await request({
          origin,
          path: `/3/device/${target.token}`,
          headers: {
            authorization: `bearer ${await providerToken()}`,
            "apns-topic": config.topic,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "apns-collapse-id": input.messageId ?? input.roomId,
            "content-type": "application/json"
          },
          body
        });
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        result.failures.push({ deviceId: target.deviceId, reason: `network: ${(err as Error).message}` });
        return result;
      }
      if (response.status === 200) {
        result.delivered += 1;
        return result;
      }
      const reason = apnsReason(response.body);
      if (response.status === 410 || APNS_DEAD_TOKEN_REASONS.has(reason)) {
        result.invalidDeviceIds.push(target.deviceId);
        result.failures.push({ deviceId: target.deviceId, reason: reason || "Unregistered" });
        return result;
      }
      if (response.status === 403 && reason === "ExpiredProviderToken" && !refreshed) {
        refreshed = true;
        await providerToken(true);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      result.failures.push({ deviceId: target.deviceId, reason: reason || `HTTP ${response.status}` });
      return result;
    }
  }

  return async (input) =>
    mergeResults(await Promise.all(input.targets.filter((t) => t.platform === "ios").map((t) => sendOne(input, t))));
}

// ---------------------------------------------------------------------------
// FCM HTTP v1
// ---------------------------------------------------------------------------

export type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type FcmFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ status: number; text(): Promise<string> }>;

export function readFcmServiceAccount(env: NodeJS.ProcessEnv = process.env): FcmServiceAccount | undefined {
  const raw = env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(json) as Partial<FcmServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON needs project_id, client_email and private_key");
  }
  return {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: normalizePem(parsed.private_key),
    token_uri: parsed.token_uri
  };
}

/** Android notification channel the app creates for crew chat. */
export const FCM_CHAT_CHANNEL_ID = "crew_chat";

function fcmErrorCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
    };
    const detail = parsed.error?.details?.find((d) => d.errorCode)?.errorCode;
    return detail ?? parsed.error?.status ?? "";
  } catch {
    return "";
  }
}

export function fcmTransport(
  account: FcmServiceAccount,
  fetchImpl: FcmFetch = fetch as unknown as FcmFetch,
  opts: { sleep?: Sleep; now?: () => number } = {}
): ChatPushTransport {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  let cached: { accessToken: string; expiresAt: number } | undefined;

  async function accessToken(force = false): Promise<string> {
    if (!force && cached && cached.expiresAt - 60_000 > now()) return cached.accessToken;
    const key = await importPKCS8(account.private_key, "RS256");
    const iat = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      }).toString()
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`FCM OAuth token request failed with ${res.status}`);
    const parsed = JSON.parse(text) as { access_token: string; expires_in?: number };
    cached = { accessToken: parsed.access_token, expiresAt: now() + (parsed.expires_in ?? 3600) * 1000 };
    return cached.accessToken;
  }

  async function sendOne(input: ChatPushDispatchInput, target: ChatPushDeliveryTarget): Promise<ChatPushDispatchResult> {
    const result = emptyResult();
    const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
    const body = JSON.stringify({
      message: {
        token: target.token,
        notification: { title: input.title, body: input.body },
        data: { type: input.kind ?? "chat", roomId: input.roomId, ...(input.messageId ? { messageId: input.messageId } : {}) },
        android: {
          priority: "HIGH",
          notification: { channel_id: FCM_CHAT_CHANNEL_ID, tag: input.roomId }
        }
      }
    });
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      result.attempts += 1;
      let status: number;
      let text: string;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
          body
        });
        status = res.status;
        text = await res.text();
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        result.failures.push({ deviceId: target.deviceId, reason: `network: ${(err as Error).message}` });
        return result;
      }
      if (status === 200) {
        result.delivered += 1;
        return result;
      }
      const code = fcmErrorCode(text);
      if (status === 404 || code === "UNREGISTERED" || (status === 400 && code === "INVALID_ARGUMENT")) {
        result.invalidDeviceIds.push(target.deviceId);
        result.failures.push({ deviceId: target.deviceId, reason: code || "UNREGISTERED" });
        return result;
      }
      if (status === 401 && !refreshed) {
        refreshed = true;
        await accessToken(true);
        continue;
      }
      if ((status === 429 || status >= 500) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      result.failures.push({ deviceId: target.deviceId, reason: code || `HTTP ${status}` });
      return result;
    }
  }

  return async (input) =>
    mergeResults(
      await Promise.all(input.targets.filter((t) => t.platform === "android").map((t) => sendOne(input, t)))
    );
}

/** Routes iOS targets to APNs and Android targets to FCM; anything unconfigured goes to `fallback`. */
export function platformRoutingTransport(parts: {
  ios?: ChatPushTransport;
  android?: ChatPushTransport;
  fallback: ChatPushTransport;
}): ChatPushTransport {
  return async (input) => {
    const ios = input.targets.filter((t) => t.platform === "ios");
    const android = input.targets.filter((t) => t.platform === "android");
    const rest = input.targets.filter(
      (t) => (t.platform === "ios" && !parts.ios) || (t.platform === "android" && !parts.android) || t.platform === "web"
    );
    const runs: Array<Promise<ChatPushDispatchResult>> = [];
    if (parts.ios && ios.length) runs.push(parts.ios({ ...input, targets: ios }));
    if (parts.android && android.length) runs.push(parts.android({ ...input, targets: android }));
    if (rest.length) runs.push(parts.fallback({ ...input, targets: rest }));
    return mergeResults(await Promise.all(runs));
  };
}
