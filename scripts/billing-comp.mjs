#!/usr/bin/env node
/**
 * Admin-only: mark a race room paid without a purchase (race directors, giveaways).
 * Calls POST /billing/admin/comp with the server's BILLING_ADMIN_SECRET. The apps never
 * hold that secret, and no code is ever typed into an app (App Review 3.1.1).
 *
 * Usage:
 *   CREWCUE_API_URL=https://api.example.com BILLING_ADMIN_SECRET=... \
 *     npm run billing:comp -- <roomId> [--unlimited]
 */
const args = process.argv.slice(2);
const unlimited = args.includes("--unlimited");
const roomId = args.find((arg) => !arg.startsWith("--"));
const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--unlimited");

const baseUrl = (process.env.CREWCUE_API_URL ?? process.env.API_BASE_URL ?? "").replace(/\/+$/, "");
const secret = process.env.BILLING_ADMIN_SECRET ?? "";

function usage(message) {
  console.error(message);
  console.error("Usage: CREWCUE_API_URL=... BILLING_ADMIN_SECRET=... npm run billing:comp -- <roomId> [--unlimited]");
  process.exit(2);
}

if (!roomId || unknown.length > 0) usage(unknown.length ? `Unknown option ${unknown[0]}` : "Missing <roomId>.");
if (!baseUrl) usage("Set CREWCUE_API_URL (or API_BASE_URL).");
if (!secret.trim()) usage("Set BILLING_ADMIN_SECRET.");

const response = await fetch(`${baseUrl}/billing/admin/comp`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-crewcue-billing-admin-secret": secret },
  body: JSON.stringify({ roomId, unlimited })
});
const text = await response.text();
if (!response.ok) {
  console.error(`Comp failed (HTTP ${response.status}): ${text}`);
  process.exit(1);
}
const view = JSON.parse(text);
const tier = view.entitlement?.crewTier === "unlimited" ? "unlimited crew" : `runner + ${view.crewLimit ?? 1} crew`;
console.log(`Room ${view.roomId} is ${view.entitlement?.status} (${tier}), source ${view.entitlement?.source}.`);
