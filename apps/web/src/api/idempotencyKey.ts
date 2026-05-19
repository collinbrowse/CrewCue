/** Stable short hash for idempotency keys derived from request bodies. */
export async function hashIdempotencyPayload(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload ?? null);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
