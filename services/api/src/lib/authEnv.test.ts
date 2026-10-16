import test from "node:test";
import assert from "node:assert/strict";
import { DEV_JWT_SECRET, authEnvProblem, validateAuthEnv } from "./authEnv.js";

test("non-production never blocks startup", () => {
  assert.equal(authEnvProblem({ nodeEnv: "development" }), null);
  assert.equal(authEnvProblem({}), null);
});

test("production with Auth0 starts with or without a JWT secret", () => {
  assert.equal(
    authEnvProblem({ nodeEnv: "production", auth0Issuer: "https://t.auth0.com/", auth0Audience: "https://api" }),
    null
  );
});

test("production without Auth0 refuses the public dev secret", () => {
  assert.match(authEnvProblem({ nodeEnv: "production" }) ?? "", /AUTH0_ISSUER/);
  assert.match(authEnvProblem({ nodeEnv: "production", jwtSecret: DEV_JWT_SECRET }) ?? "", /AUTH0_ISSUER/);
  assert.match(authEnvProblem({ nodeEnv: "production", jwtSecret: "  " }) ?? "", /AUTH0_ISSUER/);
  assert.throws(() => validateAuthEnv({ nodeEnv: "production", auth0Issuer: "https://t.auth0.com/" }));
});

test("production without Auth0 allows a private JWT secret", () => {
  assert.equal(authEnvProblem({ nodeEnv: "production", jwtSecret: "a-private-secret" }), null);
});
