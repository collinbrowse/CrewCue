import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeOAuthPendingState,
  deleteStravaConnection,
  getStravaConnection,
  getStravaConnectionPublic,
  resetStravaConnectionStoreForTests,
  saveOAuthPendingState,
  upsertStravaConnection
} from "./stravaConnectionStore.js";
import type { StravaTokenBundle } from "./strava/stravaClient.js";

function tokens(overrides: Partial<StravaTokenBundle> = {}): StravaTokenBundle {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: 2_000_000_000,
    athleteId: "strava-athlete-1",
    ...overrides
  };
}

test("OAuth pending states are athlete-scoped and consumed once", async () => {
  await resetStravaConnectionStoreForTests();

  await saveOAuthPendingState("state-mismatch", "athlete-a");

  assert.equal(await consumeOAuthPendingState("state-mismatch", "athlete-b"), false);
  assert.equal(
    await consumeOAuthPendingState("state-mismatch", "athlete-a"),
    false,
    "a mismatched OAuth state must not remain replayable by the original athlete"
  );

  await saveOAuthPendingState("state-valid", "athlete-a");

  assert.equal(await consumeOAuthPendingState("state-valid", "athlete-a"), true);
  assert.equal(await consumeOAuthPendingState("state-valid", "athlete-a"), false);
});

test("Strava connections are scoped by athlete and public reads hide tokens", async () => {
  await resetStravaConnectionStoreForTests();

  await upsertStravaConnection("athlete-a", tokens());
  await upsertStravaConnection(
    "athlete-b",
    tokens({
      accessToken: "access-b",
      refreshToken: "refresh-b",
      athleteId: "strava-athlete-b"
    })
  );

  assert.deepEqual(await getStravaConnectionPublic("athlete-a"), {
    connected: true,
    athleteId: "strava-athlete-1"
  });
  assert.deepEqual(await getStravaConnectionPublic("athlete-missing"), { connected: false });

  const athleteAConnection = await getStravaConnection("athlete-a");
  assert.deepEqual(athleteAConnection, tokens());
  if (athleteAConnection) {
    athleteAConnection.accessToken = "mutated-by-caller";
  }
  assert.equal((await getStravaConnection("athlete-a"))?.accessToken, "access-1");

  assert.equal(await deleteStravaConnection("athlete-a"), true);
  assert.equal(await deleteStravaConnection("athlete-a"), false);
  assert.equal(await getStravaConnection("athlete-a"), undefined);
  assert.equal((await getStravaConnection("athlete-b"))?.accessToken, "access-b");
});
