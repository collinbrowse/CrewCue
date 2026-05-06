import test from "node:test";
import assert from "node:assert/strict";
import { formatUnreadBadge } from "./unreadBadge";

test("unreadBadge: hides badge when zero or negative", () => {
  assert.equal(formatUnreadBadge(0), undefined);
  assert.equal(formatUnreadBadge(-3), undefined);
  assert.equal(formatUnreadBadge(Number.NaN), undefined);
});

test("unreadBadge: stringifies counts up to 99", () => {
  assert.equal(formatUnreadBadge(1), "1");
  assert.equal(formatUnreadBadge(42), "42");
  assert.equal(formatUnreadBadge(99), "99");
});

test("unreadBadge: caps display at 99+", () => {
  assert.equal(formatUnreadBadge(100), "99+");
  assert.equal(formatUnreadBadge(1500), "99+");
});
