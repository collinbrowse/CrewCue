import test from "node:test";
import assert from "node:assert/strict";
import { parseStravaOAuthCallbackUrl, STRAVA_DEEP_LINK_REDIRECT_URI } from "./stravaOAuth";

test("parseStravaOAuthCallbackUrl reads code and state from crewcue://strava", () => {
  const parsed = parseStravaOAuthCallbackUrl("crewcue://strava?code=abc&state=xyz");
  assert.deepEqual(parsed, { code: "abc", state: "xyz" });
});

test("parseStravaOAuthCallbackUrl reads HTTPS API redirect path", () => {
  const parsed = parseStravaOAuthCallbackUrl(
    "https://crewcue-staging.up.railway.app/strava/oauth/redirect?code=abc&state=xyz"
  );
  assert.deepEqual(parsed, { code: "abc", state: "xyz" });
});

test("parseStravaOAuthCallbackUrl rejects missing params or wrong path", () => {
  assert.equal(parseStravaOAuthCallbackUrl("crewcue://strava?code=abc"), undefined);
  assert.equal(parseStravaOAuthCallbackUrl("crewcue://auth?code=abc&state=xyz"), undefined);
  assert.equal(
    parseStravaOAuthCallbackUrl("https://crewcue-staging.up.railway.app/health/live?code=abc&state=xyz"),
    undefined
  );
});

test("STRAVA_DEEP_LINK_REDIRECT_URI is crewcue deep link", () => {
  assert.equal(STRAVA_DEEP_LINK_REDIRECT_URI, "crewcue://strava");
});
