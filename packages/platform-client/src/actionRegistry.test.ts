import assert from "node:assert/strict";
import test from "node:test";
import { ActionRegistry } from "./actionRegistry.js";

test("ignoreIfBusy skips second call while first in flight", async () => {
  const registry = new ActionRegistry();
  let runs = 0;
  const first = registry.run("k", "ignoreIfBusy", async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 30));
    return "a";
  });
  const second = registry.run("k", "ignoreIfBusy", async () => {
    runs += 1;
    return "b";
  });
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.status, "started");
  assert.equal(r1.value, "a");
  assert.equal(r2.status, "skipped");
  assert.equal(runs, 1);
});

test("replace aborts prior and only latest error surfaces", async () => {
  const registry = new ActionRegistry();
  const signals: string[] = [];
  const p1 = registry.run("map", "replace", async (signal) => {
    signals.push("start1");
    await new Promise((r) => setTimeout(r, 50));
    if (signal.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    return 1;
  });
  await new Promise((r) => setTimeout(r, 5));
  const p2 = registry.run("map", "replace", async () => {
    signals.push("start2");
    throw new Error("latest failed");
  });
  const [firstOutcome, secondOutcome] = await Promise.allSettled([p1, p2]);
  assert.equal(firstOutcome.status, "rejected");
  assert.equal((firstOutcome as PromiseRejectedResult).reason?.name, "AbortError");
  assert.equal(secondOutcome.status, "rejected");
  assert.match(String((secondOutcome as PromiseRejectedResult).reason), /latest failed/);
  assert.deepEqual(signals, ["start1", "start2"]);
});

test("lock skips overlapping calls", async () => {
  const registry = new ActionRegistry();
  let runs = 0;
  const first = registry.run("save", "lock", async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 25));
    return true;
  });
  const second = registry.run("save", "lock", async () => {
    runs += 1;
    return false;
  });
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.status, "started");
  assert.equal(r2.status, "skipped");
  assert.equal(runs, 1);
});
