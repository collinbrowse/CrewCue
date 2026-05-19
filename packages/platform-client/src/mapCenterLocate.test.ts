import assert from "node:assert/strict";
import test from "node:test";
import { ActionRegistry } from "./actionRegistry.js";

test("replace policy aborts prior locate attempt and latest call wins", async () => {
  const registry = new ActionRegistry();
  const p1 = registry.run("map:center-user", "replace", async (signal) => {
    await new Promise((r) => setTimeout(r, 40));
    if (signal.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    return "first";
  });
  await new Promise((r) => setTimeout(r, 5));
  const p2 = registry.run("map:center-user", "replace", async () => "second");
  const [first, second] = await Promise.allSettled([p1, p2]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "fulfilled");
  if (second.status === "fulfilled") {
    assert.equal(second.value.status, "started");
    assert.equal(second.value.value, "second");
  }
});
