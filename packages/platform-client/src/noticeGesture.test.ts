import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NOTICE_SWIPE_DISMISS_DY,
  DEFAULT_NOTICE_SWIPE_DISMISS_VY,
  shouldDismissTransientBySwipe
} from "./noticeGesture.js";

test("shouldDismissTransientBySwipe when drag exceeds distance threshold", () => {
  assert.equal(
    shouldDismissTransientBySwipe(DEFAULT_NOTICE_SWIPE_DISMISS_DY - 1, 0),
    true
  );
  assert.equal(shouldDismissTransientBySwipe(-10, 0), false);
});

test("shouldDismissTransientBySwipe when flick exceeds velocity threshold", () => {
  assert.equal(
    shouldDismissTransientBySwipe(0, DEFAULT_NOTICE_SWIPE_DISMISS_VY - 0.1),
    true
  );
  assert.equal(shouldDismissTransientBySwipe(0, 0), false);
});
