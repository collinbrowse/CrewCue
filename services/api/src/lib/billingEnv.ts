import { isExplicitDevEnv } from "./devEnv.js";

/**
 * Hand-set entitlement (POST /race-rooms/:roomId/entitlement) and the debug fake purchaser
 * bypass the store. Allowed in local dev and tests (NODE_ENV=development or test), or with
 * BILLING_MANUAL_ENTITLEMENT=enabled (staging smoke). Refused otherwise, NODE_ENV unset included.
 */
export function isManualBillingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BILLING_MANUAL_ENTITLEMENT?.trim() === "enabled") return true;
  return isExplicitDevEnv(env.NODE_ENV);
}
