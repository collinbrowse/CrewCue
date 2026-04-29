import test from "node:test";
import assert from "node:assert/strict";
import { shouldRestoreStoredSession } from "./sessionRestore";

test("shouldRestoreStoredSession rejects missing or malformed session", () => {
  assert.equal(shouldRestoreStoredSession(undefined), false);
  assert.equal(shouldRestoreStoredSession({ accessToken: "" }), false);
});

test("shouldRestoreStoredSession accepts tokens without explicit expiry", () => {
  assert.equal(shouldRestoreStoredSession({ accessToken: "token" }), true);
});

test("shouldRestoreStoredSession rejects expired tokens and accepts valid ones", () => {
  assert.equal(shouldRestoreStoredSession({ accessToken: "token", expiresAtMs: 10 }, 10), false);
  assert.equal(shouldRestoreStoredSession({ accessToken: "token", expiresAtMs: 11 }, 10), true);
});
