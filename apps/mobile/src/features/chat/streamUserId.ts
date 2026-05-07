/**
 * Stream Chat user ids are derived from Auth0 `sub` on the server
 * (`services/api/src/lib/streamChat.ts` — SHA-256 hex, first 32 chars, `u-` prefix).
 * Reproduce the same mapping on the client for display-name lookup and `isOwn`
 * checks without adding a contracts dependency on Node crypto.
 */
import * as Crypto from "expo-crypto";

const cache = new Map<string, string>();

/** Seed from `GET /chat/stream-token` so the current user matches the server exactly. */
export function rememberStreamUserIdForAuthSub(authSub: string, streamUserId: string): void {
  const t = authSub.trim();
  if (t) cache.set(t, streamUserId.trim());
}

export async function streamUserIdForAuthSub(authSub: string): Promise<string> {
  const t = authSub.trim();
  if (!t) throw new Error("streamUserIdForAuthSub: empty subject");
  const hit = cache.get(t);
  if (hit) return hit;
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    t,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  const id = `u-${digest.slice(0, 32)}`;
  cache.set(t, id);
  return id;
}
