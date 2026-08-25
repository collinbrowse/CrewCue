import test from "node:test";
import assert from "node:assert/strict";
import { parseStravaOAuthCallbackUrl, STRAVA_REDIRECT_URI } from "./stravaOAuth";

test("parseStravaOAuthCallbackUrl reads code and state from crewcue://strava", () => {
  const parsed = parseStravaOAuthCallbackUrl("crewcue://strava?code=abc&state=xyz");
  assert.deepEqual(parsed, { code: "abc", state: "xyz" });
});

test("parseStravaOAuthCallbackUrl rejects missing params or wrong path", () => {
  assert.equal(parseStravaOAuthCallbackUrl("crewcue://strava?code=abc"), undefined);
  assert.equal(parseStravaOAuthCallbackUrl("crewcue://auth?code=abc&state=xyz"), undefined);
});

test("STRAVA_REDIRECT_URI matches API default", () => {
  assert.equal(STRAVA_REDIRECT_URI, "crewcue://strava");
});
