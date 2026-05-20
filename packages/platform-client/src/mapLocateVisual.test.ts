import assert from "node:assert/strict";
import test from "node:test";
import { nextUserLocateVisual } from "./mapLocateVisual.js";

test("nextUserLocateVisual press starts locating pulse", () => {
  assert.equal(nextUserLocateVisual("default", { type: "press" }), "locating");
  assert.equal(nextUserLocateVisual("latched", { type: "press" }), "locating");
});

test("nextUserLocateVisual success latches blue state", () => {
  assert.equal(nextUserLocateVisual("locating", { type: "success" }), "latched");
});

test("nextUserLocateVisual failure resets to default", () => {
  assert.equal(nextUserLocateVisual("locating", { type: "failure" }), "default");
  assert.equal(nextUserLocateVisual("latched", { type: "failure" }), "default");
});

test("nextUserLocateVisual skipped only clears in-flight locating", () => {
  assert.equal(nextUserLocateVisual("locating", { type: "skipped" }), "default");
  assert.equal(nextUserLocateVisual("latched", { type: "skipped" }), "latched");
});

test("nextUserLocateVisual aborted preserves current visual", () => {
  assert.equal(nextUserLocateVisual("locating", { type: "aborted" }), "locating");
});
