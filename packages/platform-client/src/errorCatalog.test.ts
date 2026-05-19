import assert from "node:assert/strict";
import test from "node:test";
import { getErrorMessage, listErrorCatalogKeys } from "./errorCatalog.js";

test("catalog keys resolve to non-empty strings", () => {
  for (const key of listErrorCatalogKeys()) {
    const message = getErrorMessage(key);
    assert.ok(message.length > 0);
  }
});
