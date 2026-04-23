import test from "node:test";
import assert from "node:assert/strict";
import { validateAutomationAuthPayload } from "./automationAuthGuard.js";

test("disabled guard always passes", () => {
  const reason = validateAutomationAuthPayload(
    { sub: "user|1", azp: "abc", aud: "https://api.example" },
    { enabled: false, blockInProduction: true }
  );
  assert.equal(reason, null);
});

test("guard can reject in production", () => {
  const reason = validateAutomationAuthPayload(
    { sub: "user|1", azp: "abc", aud: "https://api.example" },
    {
      enabled: true,
      blockInProduction: true,
      nodeEnv: "production",
      allowedSub: "user|1",
    }
  );
  assert.equal(reason, "automation_auth_disabled_in_production");
});

test("guard validates sub/azp/audience", () => {
  const config = {
    enabled: true,
    blockInProduction: true,
    nodeEnv: "staging",
    allowedSub: "auth0|automation",
    allowedAzp: "client_123",
    expectedAudience: "https://api.automation.crewcue.dev",
  };

  assert.equal(
    validateAutomationAuthPayload(
      {
        sub: "auth0|automation",
        azp: "client_123",
        aud: ["https://api.automation.crewcue.dev", "https://example"],
      },
      config
    ),
    null
  );

  assert.equal(
    validateAutomationAuthPayload(
      {
        sub: "auth0|other",
        azp: "client_123",
        aud: "https://api.automation.crewcue.dev",
      },
      config
    ),
    "automation_sub_mismatch"
  );

  assert.equal(
    validateAutomationAuthPayload(
      {
        sub: "auth0|automation",
        azp: "wrong",
        aud: "https://api.automation.crewcue.dev",
      },
      config
    ),
    "automation_azp_mismatch"
  );

  assert.equal(
    validateAutomationAuthPayload(
      {
        sub: "auth0|automation",
        azp: "client_123",
        aud: "https://another-audience",
      },
      config
    ),
    "automation_audience_mismatch"
  );
});
