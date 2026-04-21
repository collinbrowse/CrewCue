import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_SCHEMA_VERSION } from "../src/index.ts";

test("PLATFORM_SCHEMA_VERSION is a semver-like string", () => {
  assert.match(PLATFORM_SCHEMA_VERSION, /^\d{4}\.\d{2}\.\d+$/);
});
