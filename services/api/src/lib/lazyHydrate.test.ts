import assert from "node:assert/strict";
import test from "node:test";
import { createLazyHydrator } from "./lazyHydrate.js";

test("concurrent loadIfNeeded shares one in-flight load and waits for it", async () => {
  const hydrator = createLazyHydrator();
  let loadCount = 0;
  let releaseLoad!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });

  const load = async () => {
    loadCount += 1;
    await gate;
  };

  const first = hydrator.loadIfNeeded("room-1", load);
  const second = hydrator.loadIfNeeded("room-1", load);

  // Both callers are waiting on the same in-flight load.
  await Promise.resolve();
  assert.equal(loadCount, 1);
  assert.equal(hydrator.isHydrated("room-1"), false);

  releaseLoad();
  await Promise.all([first, second]);

  assert.equal(loadCount, 1);
  assert.equal(hydrator.isHydrated("room-1"), true);

  await hydrator.loadIfNeeded("room-1", load);
  assert.equal(loadCount, 1);
});

test("failed load is not marked hydrated and can retry", async () => {
  const hydrator = createLazyHydrator();
  let attempts = 0;

  await assert.rejects(
    () =>
      hydrator.loadIfNeeded("room-1", async () => {
        attempts += 1;
        throw new Error("db unavailable");
      }),
    /db unavailable/
  );
  assert.equal(hydrator.isHydrated("room-1"), false);

  await hydrator.loadIfNeeded("room-1", async () => {
    attempts += 1;
  });
  assert.equal(attempts, 2);
  assert.equal(hydrator.isHydrated("room-1"), true);
});

test("concurrent waiter sees state written by the shared load", async () => {
  const hydrator = createLazyHydrator();
  const store = new Map<string, string>();
  let releaseLoad!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });

  const loadFromDb = async () => {
    await gate;
    store.set("room-1", "durable-visits");
  };

  const first = (async () => {
    await hydrator.loadIfNeeded("room-1", loadFromDb);
    return store.get("room-1");
  })();

  const second = (async () => {
    // Simulate the old bug path: if hydration were marked early, this caller
    // would skip the load and bootstrap empty state over durable data.
    await hydrator.loadIfNeeded("room-1", loadFromDb);
    if (!store.has("room-1")) {
      store.set("room-1", "bootstrap-wiped");
    }
    return store.get("room-1");
  })();

  await Promise.resolve();
  releaseLoad();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, "durable-visits");
  assert.equal(b, "durable-visits");
});
