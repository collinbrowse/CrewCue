import test from "node:test";
import assert from "node:assert/strict";
import { DEV_JWT_SECRET, authEnvProblem, validateAuthEnv } from "./authEnv.js";
import { isManualBillingAllowed } from "./billingEnv.js";

test("explicit dev and test never block startup", () => {
  assert.equal(authEnvProblem({ nodeEnv: "development" }), null);
  assert.equal(authEnvProblem({ nodeEnv: "test" }), null);
  assert.equal(authEnvProblem({ nodeEnv: "test", jwtSecret: DEV_JWT_SECRET }), null);
});

test("unset or unknown NODE_ENV counts as deployed and refuses the public dev secret", () => {
  for (const nodeEnv of [undefined, "", "staging", "prod", "Production"]) {
    assert.match(authEnvProblem({ nodeEnv }) ?? "", /AUTH0_ISSUER/, String(nodeEnv));
    assert.match(authEnvProblem({ nodeEnv, jwtSecret: DEV_JWT_SECRET }) ?? "", /AUTH0_ISSUER/, String(nodeEnv));
  }
  assert.throws(() => validateAuthEnv({}));
});

test("production with Auth0 starts with or without a JWT secret", () => {
  assert.equal(
    authEnvProblem({ nodeEnv: "production", auth0Issuer: "https://t.auth0.com/", auth0Audience: "https://api" }),
    null
  );
  assert.equal(authEnvProblem({ auth0Issuer: "https://t.auth0.com/", auth0Audience: "https://api" }), null);
});

test("production without Auth0 refuses the public secrets", () => {
  assert.match(authEnvProblem({ nodeEnv: "production" }) ?? "", /AUTH0_ISSUER/);
  assert.match(authEnvProblem({ nodeEnv: "production", jwtSecret: DEV_JWT_SECRET }) ?? "", /AUTH0_ISSUER/);
  assert.match(authEnvProblem({ nodeEnv: "production", jwtSecret: "replace-with-dev-secret" }) ?? "", /AUTH0_ISSUER/);
  assert.match(authEnvProblem({ nodeEnv: "production", jwtSecret: "  " }) ?? "", /AUTH0_ISSUER/);
  assert.throws(() => validateAuthEnv({ nodeEnv: "production", auth0Issuer: "https://t.auth0.com/" }));
});

test("production without Auth0 allows a private JWT secret", () => {
  assert.equal(authEnvProblem({ nodeEnv: "production", jwtSecret: "a-private-secret" }), null);
  assert.equal(authEnvProblem({ jwtSecret: "a-private-secret" }), null);
});

test("manual billing needs explicit dev or the staging flag", () => {
  assert.equal(isManualBillingAllowed({ NODE_ENV: "development" }), true);
  assert.equal(isManualBillingAllowed({ NODE_ENV: "test" }), true);
  assert.equal(isManualBillingAllowed({}), false);
  assert.equal(isManualBillingAllowed({ NODE_ENV: "production" }), false);
  assert.equal(isManualBillingAllowed({ NODE_ENV: "staging" }), false);
  assert.equal(isManualBillingAllowed({ BILLING_MANUAL_ENTITLEMENT: "enabled" }), true);
  assert.equal(isManualBillingAllowed({ NODE_ENV: "production", BILLING_MANUAL_ENTITLEMENT: "enabled" }), true);
});
