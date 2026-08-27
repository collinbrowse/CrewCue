import test from "node:test";
import assert from "node:assert/strict";
import {
  isStravaOAuthDeepLink,
  parseStravaOAuthCallbackResult,
  parseStravaOAuthCallbackUrl,
  STRAVA_DEEP_LINK_REDIRECT_URI
} from "./stravaOAuth";

test("parseStravaOAuthCallbackUrl reads code and state from crewcue://strava", () => {
  const parsed = parseStravaOAuthCallbackUrl("crewcue://strava?code=abc&state=xyz");
  assert.deepEqual(parsed, { code: "abc", state: "xyz" });
});

test("parseStravaOAuthCallbackUrl forwards granted scope when present", () => {
  const parsed = parseStravaOAuthCallbackUrl(
    "crewcue://strava?code=abc&state=xyz&scope=read%2Cactivity%3Aread_all"
  );
  assert.deepEqual(parsed, { code: "abc", state: "xyz", scope: "read,activity:read_all" });
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

test("isStravaOAuthDeepLink detects crewcue Strava callback only", () => {
  assert.equal(isStravaOAuthDeepLink("crewcue://strava?code=abc&state=xyz"), true);
  assert.equal(isStravaOAuthDeepLink("crewcue://profile"), false);
  assert.equal(
    isStravaOAuthDeepLink("https://crewcue-staging.up.railway.app/strava/oauth/redirect?code=a&state=b"),
    true
  );
});

test("parseStravaOAuthCallbackResult reads Strava error bounce", () => {
  const parsed = parseStravaOAuthCallbackResult("crewcue://strava?error=access_denied&error_description=Nope");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.message, /Nope/);
  }
});

test("STRAVA_DEEP_LINK_REDIRECT_URI is crewcue deep link", () => {
  assert.equal(STRAVA_DEEP_LINK_REDIRECT_URI, "crewcue://strava");
});
