import { createHash } from "node:crypto";

/**
 * Test helper: an APNs-shaped device token (64 hex characters, as iOS sends it) derived from
 * `seed`, so each test can name its phones and still pass the API's push token check.
 */
export function fakeApnsToken(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}
