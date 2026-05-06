/**
 * Server-side Stream Chat token minting.
 *
 * Stream Chat user tokens are HS256 JWTs whose payload contains a `user_id`
 * claim and which are signed with the team's API secret. The client uses
 * these tokens to connect to the Stream realtime backend; the server never
 * sees plaintext message content because we encrypt before handing the
 * payload to Stream.
 *
 * Reference: https://getstream.io/chat/docs/javascript/tokens_and_authentication/
 */
import { createHash, createHmac } from "node:crypto";

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export type StreamCredentials = {
  apiKey: string;
  apiSecret: string;
};

/**
 * Stream restricts user ids to a narrower character set than Auth0 `sub`.
 * We derive a deterministic, stream-safe id from the identity subject.
 */
export function deriveStreamUserId(identitySub: string): string {
  const trimmed = identitySub.trim();
  if (!trimmed) {
    throw new Error("deriveStreamUserId: identitySub is required");
  }
  const digest = createHash("sha256").update(trimmed, "utf8").digest("hex");
  // lower-case hex plus `u-` prefix fits Stream's allowed user-id charset.
  return `u-${digest.slice(0, 32)}`;
}

export function readStreamCredentials(): StreamCredentials | undefined {
  const apiKey = process.env.STREAM_API_KEY?.trim();
  const apiSecret = process.env.STREAM_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    return undefined;
  }
  return { apiKey, apiSecret };
}

/**
 * Mint a Stream Chat user token. Tokens are signed with HS256 using the team
 * secret. Stream tokens have no built-in expiration, but we can include `exp`
 * to enforce one. Default expiry is 1 hour.
 */
export function mintStreamUserToken(
  userId: string,
  apiSecret: string,
  options: { expiresInSeconds?: number; issuedAtMs?: number } = {}
): string {
  if (!userId.trim()) {
    throw new Error("mintStreamUserToken: userId is required");
  }
  if (!apiSecret.trim()) {
    throw new Error("mintStreamUserToken: apiSecret is required");
  }
  const issuedAtMs = options.issuedAtMs ?? Date.now();
  const iat = Math.floor(issuedAtMs / 1000);
  const expSeconds = options.expiresInSeconds ?? 60 * 60;
  const payload = {
    user_id: userId,
    iat,
    exp: iat + expSeconds
  };
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", apiSecret).update(signingInput).digest();
  const sigB64 = base64UrlEncode(sig);
  return `${signingInput}.${sigB64}`;
}
