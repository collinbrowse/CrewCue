import test from "node:test";
import assert from "node:assert/strict";
import { logSafeUrl } from "./logSafeUrl.js";

test("drops the query string", () => {
  assert.equal(logSafeUrl("/strava/oauth/redirect?code=abc&state=xyz"), "/strava/oauth/redirect");
  assert.equal(logSafeUrl("/geocode?q=12%20Main%20St"), "/geocode");
});

test("keeps a path with no query", () => {
  assert.equal(logSafeUrl("/race-rooms/r1/pings"), "/race-rooms/r1/pings");
  assert.equal(logSafeUrl("/"), "/");
});
