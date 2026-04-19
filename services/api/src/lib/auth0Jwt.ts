import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksBaseUrl: string | undefined;

export function isAuth0Configured(): boolean {
  return Boolean(process.env.AUTH0_ISSUER?.trim() && process.env.AUTH0_AUDIENCE?.trim());
}

function remoteJwks(): ReturnType<typeof createRemoteJWKSet> {
  const issuer = process.env.AUTH0_ISSUER!.trim();
  const base = issuer.replace(/\/$/, "");
  if (!jwks || jwksBaseUrl !== base) {
    jwksBaseUrl = base;
    jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
  }
  return jwks;
}

/**
 * Verifies an Auth0 access token (RS256 + JWKS). `iss` and `aud` must match env configuration.
 */
export async function verifyAuth0AccessToken(token: string): Promise<Record<string, unknown>> {
  const issuer = process.env.AUTH0_ISSUER!.trim();
  const audience = process.env.AUTH0_AUDIENCE!.trim();
  const { payload } = await jwtVerify(token, remoteJwks(), {
    issuer,
    audience,
  });
  return payload as Record<string, unknown>;
}
