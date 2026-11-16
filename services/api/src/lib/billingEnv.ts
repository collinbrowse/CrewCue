/**
 * Hand-set entitlement (POST /race-rooms/:roomId/entitlement) and the debug fake purchaser
 * bypass the store. Production refuses both unless BILLING_MANUAL_ENTITLEMENT=enabled
 * (staging smoke). Local dev and tests (NODE_ENV not production) allow them.
 */
export function isManualBillingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BILLING_MANUAL_ENTITLEMENT?.trim() === "enabled") return true;
  return env.NODE_ENV !== "production";
}
