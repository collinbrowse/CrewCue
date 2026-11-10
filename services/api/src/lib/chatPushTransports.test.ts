import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import {
  APNS_DEVELOPMENT_ORIGIN,
  APNS_PRODUCTION_ORIGIN,
  apnsTransport,
  fcmTransport,
  normalizePem,
  platformRoutingTransport,
  readApnsConfig,
  readFcmServiceAccount,
  type ApnsRequest,
  type FcmFetch
} from "./chatPushTransports.js";
import type { ChatPushDispatchInput } from "./chatPushDispatch.js";

const ecKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const rsaKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  type: "pkcs8",
  format: "pem"
}) as string;

const noSleep = async () => undefined;

function input(targets: ChatPushDispatchInput["targets"]): ChatPushDispatchInput {
  return { kind: "chat", roomId: "room-1", messageId: "42", title: "Leadville 100", body: "Ada: on my way", targets };
}

const apnsConfig = { keyP8: ecKey, keyId: "KEY123", teamId: "TEAM456", topic: "com.crewcue.app" };

test("APNs: signs a provider JWT and posts the alert to the token's gateway", async () => {
  const calls: Parameters<ApnsRequest>[0][] = [];
  const transport = apnsTransport(apnsConfig, async (req) => {
    calls.push(req);
    return { status: 200, body: "" };
  }, { sleep: noSleep });
  const result = await transport(
    input([
      { platform: "ios", token: "prod-token", userId: "u1", deviceId: "d1" },
      { platform: "ios", token: "dev-token", userId: "u2", deviceId: "d2", apnsEnvironment: "development" },
      { platform: "android", token: "fcm", userId: "u3", deviceId: "d3" }
    ])
  );
  assert.equal(result.delivered, 2);
  assert.equal(calls.length, 2, "android targets are not APNs' job");
  const prod = calls.find((c) => c.path === "/3/device/prod-token")!;
  const dev = calls.find((c) => c.path === "/3/device/dev-token")!;
  assert.equal(prod.origin, APNS_PRODUCTION_ORIGIN);
  assert.equal(dev.origin, APNS_DEVELOPMENT_ORIGIN);
  assert.equal(prod.headers["apns-topic"], "com.crewcue.app");
  assert.equal(prod.headers["apns-push-type"], "alert");
  const jwt = prod.headers.authorization!.replace(/^bearer /, "");
  assert.equal(decodeProtectedHeader(jwt).kid, "KEY123");
  assert.equal(decodeProtectedHeader(jwt).alg, "ES256");
  assert.equal(decodeJwt(jwt).iss, "TEAM456");
  const payload = JSON.parse(prod.body) as { aps: { alert: { title: string; body: string } }; roomId: string; type: string };
  assert.equal(payload.aps.alert.title, "Leadville 100");
  assert.equal(payload.aps.alert.body, "Ada: on my way");
  assert.equal(payload.roomId, "room-1");
  assert.equal(payload.type, "chat");
});

test("APNs: 410 and BadDeviceToken mark the token for pruning", async () => {
  const transport = apnsTransport(apnsConfig, async ({ path }) =>
    path.endsWith("gone")
      ? { status: 410, body: JSON.stringify({ reason: "Unregistered" }) }
      : { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) }
  , { sleep: noSleep });
  const result = await transport(
    input([
      { platform: "ios", token: "gone", userId: "u1", deviceId: "d1" },
      { platform: "ios", token: "bad", userId: "u1", deviceId: "d2" }
    ])
  );
  assert.deepEqual(result.invalidDeviceIds.sort(), ["d1", "d2"]);
  assert.equal(result.delivered, 0);
});

test("APNs: retries 503 and network errors, then gives up without pruning", async () => {
  let n = 0;
  const transport = apnsTransport(apnsConfig, async () => {
    n += 1;
    if (n === 1) throw new Error("ECONNRESET");
    if (n === 2) return { status: 503, body: "" };
    return { status: 200, body: "" };
  }, { sleep: noSleep });
  const ok = await transport(input([{ platform: "ios", token: "t", userId: "u", deviceId: "d" }]));
  assert.equal(ok.delivered, 1);
  assert.equal(ok.attempts, 3);

  const down = apnsTransport(apnsConfig, async () => ({ status: 500, body: "" }), { sleep: noSleep });
  const failed = await down(input([{ platform: "ios", token: "t", userId: "u", deviceId: "d" }]));
  assert.equal(failed.attempts, 3);
  assert.equal(failed.failures.length, 1);
  assert.deepEqual(failed.invalidDeviceIds, []);
});

test("APNs: ExpiredProviderToken re-signs once", async () => {
  const tokens: string[] = [];
  let clock = 1_000_000;
  const transport = apnsTransport(
    apnsConfig,
    async ({ headers }) => {
      tokens.push(headers.authorization!);
      if (tokens.length === 1) {
        clock += 2000;
        return { status: 403, body: JSON.stringify({ reason: "ExpiredProviderToken" }) };
      }
      return { status: 200, body: "" };
    },
    { sleep: noSleep, now: () => clock }
  );
  const result = await transport(input([{ platform: "ios", token: "t", userId: "u", deviceId: "d" }]));
  assert.equal(result.delivered, 1);
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1]);
});

const account = {
  project_id: "crewcue-test",
  client_email: "push@crewcue-test.iam.gserviceaccount.com",
  private_key: rsaKey
};

function fakeFcm(handler: (url: string, body: string) => { status: number; body: string }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetchImpl: FcmFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url === "https://oauth2.googleapis.com/token") {
      return { status: 200, text: async () => JSON.stringify({ access_token: `at-${calls.length}`, expires_in: 3600 }) };
    }
    const res = handler(url, init.body);
    return { status: res.status, text: async () => res.body };
  };
  return { calls, fetchImpl };
}

test("FCM: exchanges the service account for a token and sends HTTP v1 messages", async () => {
  const { calls, fetchImpl } = fakeFcm(() => ({ status: 200, body: "{}" }));
  const transport = fcmTransport(account, fetchImpl, { sleep: noSleep });
  const result = await transport(
    input([
      { platform: "android", token: "fcm-1", userId: "u1", deviceId: "d1" },
      { platform: "ios", token: "apns", userId: "u2", deviceId: "d2" }
    ])
  );
  assert.equal(result.delivered, 1);
  const tokenCall = calls[0]!;
  const assertion = new URLSearchParams(tokenCall.body).get("assertion")!;
  const claims = decodeJwt(assertion);
  assert.equal(claims.iss, account.client_email);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/firebase.messaging");
  const send = calls[1]!;
  assert.equal(send.url, "https://fcm.googleapis.com/v1/projects/crewcue-test/messages:send");
  assert.equal(send.headers.authorization, "Bearer at-1");
  const message = (JSON.parse(send.body) as {
    message: { token: string; data: Record<string, string>; android: { notification: { channel_id: string } } };
  }).message;
  assert.equal(message.token, "fcm-1");
  assert.equal(message.data.roomId, "room-1");
  assert.equal(message.data.type, "chat");
  assert.equal(message.android.notification.channel_id, "crew_chat");
});

test("FCM: UNREGISTERED and 404 prune; 429 retries; access token is reused", async () => {
  let sends = 0;
  const { calls, fetchImpl } = fakeFcm((_url, body) => {
    sends += 1;
    const token = (JSON.parse(body) as { message: { token: string } }).message.token;
    if (token === "dead") {
      return {
        status: 404,
        body: JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })
      };
    }
    if (token === "busy" && sends < 4) return { status: 429, body: "{}" };
    return { status: 200, body: "{}" };
  });
  const transport = fcmTransport(account, fetchImpl, { sleep: noSleep });
  const first = await transport(input([{ platform: "android", token: "dead", userId: "u", deviceId: "d-dead" }]));
  assert.deepEqual(first.invalidDeviceIds, ["d-dead"]);
  const second = await transport(input([{ platform: "android", token: "busy", userId: "u", deviceId: "d-busy" }]));
  assert.equal(second.delivered, 1);
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1);
});

test("platformRoutingTransport sends unconfigured platforms to the fallback", async () => {
  const seen: string[] = [];
  const transport = platformRoutingTransport({
    ios: async (i) => {
      seen.push(...i.targets.map((t) => `apns:${t.deviceId}`));
      return { delivered: i.targets.length, attempts: i.targets.length, failures: [], invalidDeviceIds: [] };
    },
    fallback: async (i) => {
      seen.push(...i.targets.map((t) => `log:${t.deviceId}`));
      return { delivered: 0, attempts: 0, failures: [], invalidDeviceIds: [] };
    }
  });
  const result = await transport(
    input([
      { platform: "ios", token: "a", userId: "u", deviceId: "i" },
      { platform: "android", token: "b", userId: "u", deviceId: "a" }
    ])
  );
  assert.deepEqual(seen.sort(), ["apns:i", "log:a"]);
  assert.equal(result.delivered, 1);
});

test("env readers accept escaped and base64 keys", () => {
  const escaped = ecKey.replace(/\n/g, "\\n");
  assert.equal(normalizePem(escaped).trim(), ecKey.trim());
  assert.equal(normalizePem(Buffer.from(ecKey).toString("base64")).trim(), ecKey.trim());
  const apns = readApnsConfig({ APNS_KEY_P8: escaped, APNS_KEY_ID: "k", APNS_TEAM_ID: "t", APNS_TOPIC: "b" });
  assert.ok(apns?.keyP8.includes("-----BEGIN PRIVATE KEY-----\n"));
  assert.equal(readApnsConfig({ APNS_KEY_ID: "k" }), undefined);
  const fcm = readFcmServiceAccount({
    FCM_SERVICE_ACCOUNT_JSON: Buffer.from(JSON.stringify({ ...account, private_key: escaped })).toString("base64")
  });
  assert.equal(fcm?.project_id, "crewcue-test");
  assert.ok(fcm?.private_key.includes("\n"));
});
