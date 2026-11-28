import test from "node:test";
import assert from "node:assert/strict";
import {
  DEV_ROOM_REMOVAL_HASH_KEY,
  hashRemovedUserId,
  roomRemovalEnvProblem,
  validateRoomRemovalEnv
} from "./roomRemovalEnv.js";

const PRIVATE_KEY = "k".repeat(40);

test("outside production the dev key is used and startup is never blocked", () => {
  assert.equal(roomRemovalEnvProblem({ nodeEnv: "development" }), null);
  assert.equal(roomRemovalEnvProblem({}), null);
  assert.equal(
    hashRemovedUserId("google-oauth2|1", {}),
    hashRemovedUserId("google-oauth2|1", { hashKey: DEV_ROOM_REMOVAL_HASH_KEY })
  );
});

test("production needs a private key of its own", () => {
  assert.match(roomRemovalEnvProblem({ nodeEnv: "production" }) ?? "", /ROOM_REMOVAL_HASH_KEY/);
  assert.match(roomRemovalEnvProblem({ nodeEnv: "production", hashKey: "short" }) ?? "", /ROOM_REMOVAL_HASH_KEY/);
  assert.match(
    roomRemovalEnvProblem({ nodeEnv: "production", hashKey: DEV_ROOM_REMOVAL_HASH_KEY }) ?? "",
    /ROOM_REMOVAL_HASH_KEY/
  );
  assert.throws(() => validateRoomRemovalEnv({ nodeEnv: "production" }));
  assert.equal(roomRemovalEnvProblem({ nodeEnv: "production", hashKey: PRIVATE_KEY }), null);
  assert.throws(() => hashRemovedUserId("auth0|1", { nodeEnv: "production" }));
});

test("the hash is stable per key and differs across users and keys", () => {
  const env = { hashKey: PRIVATE_KEY };
  const a = hashRemovedUserId("apple|abc", env);
  assert.equal(a, hashRemovedUserId("apple|abc", env));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, hashRemovedUserId("apple|abd", env));
  assert.notEqual(a, hashRemovedUserId("apple|abc", { hashKey: "j".repeat(40) }));
  assert.equal(a.includes("apple"), false);
});
