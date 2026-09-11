import assert from "node:assert/strict";
import test from "node:test";
import { NoticeBus } from "./noticeBus.js";

test("presentTransient replaces prior transient", () => {
  const bus = new NoticeBus();
  bus.presentTransient({ fingerprint: "a", catalogKey: "unknown" });
  const firstId = bus.getState().transient?.id;
  bus.presentTransient({ fingerprint: "b", catalogKey: "networkOffline" });
  const state = bus.getState();
  assert.equal(state.transient?.catalogKey, "networkOffline");
  assert.notEqual(state.transient?.id, firstId);
});

test("dedupes same fingerprint within window", () => {
  const bus = new NoticeBus();
  bus.presentTransient({ fingerprint: "same", catalogKey: "unknown" });
  const id = bus.getState().transient?.id;
  bus.presentTransient({ fingerprint: "same", catalogKey: "saveFailed" });
  assert.equal(bus.getState().transient?.id, id);
});

test("dedupes same fingerprint after dismiss within window", () => {
  const bus = new NoticeBus();
  bus.presentTransient({ fingerprint: "same", catalogKey: "unknown", dedupeMs: 5_000 });
  bus.dismissTransient();
  assert.equal(bus.getState().transient, undefined);
  bus.presentTransient({ fingerprint: "same", catalogKey: "unknown", dedupeMs: 5_000 });
  assert.equal(bus.getState().transient, undefined);
});

test("inline notices are scoped by anchorId", () => {
  const bus = new NoticeBus();
  bus.presentInline({ anchorId: "save", catalogKey: "saveFailed" });
  bus.presentInline({ anchorId: "other", catalogKey: "invalidInput" });
  assert.equal(bus.getState().inlineByAnchor.save?.catalogKey, "saveFailed");
  bus.clearInline("save");
  assert.equal(bus.getState().inlineByAnchor.save, undefined);
  assert.equal(bus.getState().inlineByAnchor.other?.catalogKey, "invalidInput");
});
