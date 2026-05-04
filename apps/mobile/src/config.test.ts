import test from "node:test";
import assert from "node:assert/strict";
import { loadMobileConfig } from "./config";

const KEYS = [
  "EXPO_PUBLIC_AUTH0_DOMAIN",
  "EXPO_PUBLIC_AUTH0_CLIENT_ID",
  "EXPO_PUBLIC_AUTH0_AUDIENCE",
  "EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE",
  "EXPO_PUBLIC_AUTH0_CONNECTION_APPLE",
  "EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL",
  "EXPO_PUBLIC_API_BASE_URL"
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of KEYS) {
    out[k] = process.env[k];
  }
  return out;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of KEYS) {
    const v = snap[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

test("loadMobileConfig returns missing keys when env is incomplete", () => {
  const snap = snapshotEnv();
  try {
    for (const k of KEYS) {
      delete process.env[k];
    }
    const r = loadMobileConfig();
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.missing.length >= 1);
      assert.ok(r.missing.includes("EXPO_PUBLIC_AUTH0_DOMAIN"));
    }
  } finally {
    restoreEnv(snap);
  }
});

test("loadMobileConfig strips trailing slash from API base URL", () => {
  const snap = snapshotEnv();
  try {
    process.env.EXPO_PUBLIC_AUTH0_DOMAIN = "dev.example.auth0.com";
    process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID = "cid";
    process.env.EXPO_PUBLIC_AUTH0_AUDIENCE = "https://api.audience/";
    process.env.EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE = "google-oauth2";
    process.env.EXPO_PUBLIC_AUTH0_CONNECTION_APPLE = "apple";
    process.env.EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL = "Username-Password-Authentication";
    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.com/";
    const r = loadMobileConfig();
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.config.apiBaseUrl, "https://api.example.com");
    }
  } finally {
    restoreEnv(snap);
  }
});
