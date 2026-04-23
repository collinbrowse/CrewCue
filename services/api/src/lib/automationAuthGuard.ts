export type AutomationGuardConfig = {
  enabled: boolean;
  allowedSub?: string;
  allowedAzp?: string;
  expectedAudience?: string;
  blockInProduction: boolean;
  nodeEnv?: string;
};

export function readAutomationGuardConfig(): AutomationGuardConfig {
  return {
    enabled: process.env.AUTOMATION_AUTH_ENABLED === "true",
    allowedSub: process.env.AUTOMATION_ALLOWED_SUB?.trim() || undefined,
    allowedAzp: process.env.AUTOMATION_ALLOWED_AZP?.trim() || undefined,
    expectedAudience: process.env.AUTH0_AUDIENCE?.trim() || undefined,
    blockInProduction: process.env.AUTOMATION_BLOCK_IN_PRODUCTION !== "false",
    nodeEnv: process.env.NODE_ENV,
  };
}

function claimAudience(payload: Record<string, unknown>): string[] {
  const aud = payload.aud;
  if (typeof aud === "string" && aud.length > 0) {
    return [aud];
  }
  if (Array.isArray(aud)) {
    return aud.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}

/**
 * Returns null when payload passes automation guard checks, otherwise returns
 * a short reason string for logs.
 */
export function validateAutomationAuthPayload(
  payload: Record<string, unknown>,
  config: AutomationGuardConfig
): string | null {
  if (!config.enabled) {
    return null;
  }
  if (config.blockInProduction && config.nodeEnv === "production") {
    return "automation_auth_disabled_in_production";
  }

  if (config.allowedSub) {
    const sub = payload.sub;
    if (sub !== config.allowedSub) {
      return "automation_sub_mismatch";
    }
  }

  if (config.allowedAzp) {
    const azp = payload.azp;
    if (azp !== config.allowedAzp) {
      return "automation_azp_mismatch";
    }
  }

  if (config.expectedAudience) {
    const audiences = claimAudience(payload);
    if (!audiences.includes(config.expectedAudience)) {
      return "automation_audience_mismatch";
    }
  }

  return null;
}
