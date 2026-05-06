import test from "node:test";
import assert from "node:assert/strict";
import { isValidPref } from "./notificationPrefs";

test("notificationPrefs: accepts canonical values", () => {
  assert.equal(isValidPref("all"), true);
  assert.equal(isValidPref("mentions"), true);
  assert.equal(isValidPref("none"), true);
});

test("notificationPrefs: rejects unknown values", () => {
  assert.equal(isValidPref("everyone"), false);
  assert.equal(isValidPref(""), false);
  assert.equal(isValidPref(null), false);
  assert.equal(isValidPref(undefined), false);
  assert.equal(isValidPref(7), false);
});
