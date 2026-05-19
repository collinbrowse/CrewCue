import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJsonStringify } from "./canonicalJson.js";

test("canonicalJsonStringify sorts object keys", () => {
  const a = canonicalJsonStringify({ z: 1, a: { y: 2, b: 3 } });
  const b = canonicalJsonStringify({ a: { b: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
});

test("canonicalJsonStringify preserves array order", () => {
  assert.equal(canonicalJsonStringify([2, 1]), "[2,1]");
});
