import assert from "node:assert/strict";
import test from "node:test";
import { getErrorMessage } from "./errorCatalog.js";
import { mapApiError } from "./mapApiError.js";

test("mapApiError never includes HTTP status in message", () => {
  const mapped = mapApiError({ status: 400, message: "Bad Request — validation failed" });
  assert.equal(mapped.message, getErrorMessage(mapped.key));
  assert.equal(mapped.message.includes("400"), false);
  assert.equal(mapped.message.includes("Bad Request"), false);
});

test("mapApiError maps status to catalog keys", () => {
  assert.equal(mapApiError({ status: 403 }).key, "forbidden");
  assert.equal(mapApiError({ status: 404 }).key, "notFound");
});
