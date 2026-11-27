import { isExplicitDevEnv } from "./devEnv.js";

/** The HS256 fallback secret in `plugins/auth.ts`. It is public, so a deployed API must never verify with it. */
export const DEV_JWT_SECRET = "dev-only-secret";

/** Secrets published in this repo (the fallback and the `.env*.example` placeholder). */
const PUBLIC_JWT_SECRETS: readonly string[] = [DEV_JWT_SECRET, "replace-with-dev-secret"];

export type AuthEnv = {
  nodeEnv?: string;
  auth0Issuer?: string;
  auth0Audience?: string;
  jwtSecret?: string;
};

export function readAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return {
    nodeEnv: env.NODE_ENV,
    auth0Issuer: env.AUTH0_ISSUER,
    auth0Audience: env.AUTH0_AUDIENCE,
    jwtSecret: env.JWT_SECRET
  };
}

/**
 * Returns a startup error when the API would accept tokens signed with a public secret outside
 * explicit dev (NODE_ENV=development or test). Unset NODE_ENV counts as deployed. With Auth0
 * configured the HS256 path is never used, so any JWT_SECRET is fine there.
 */
export function authEnvProblem(env: AuthEnv): string | null {
  if (isExplicitDevEnv(env.nodeEnv)) return null;
  const auth0 = Boolean(env.auth0Issuer?.trim() && env.auth0Audience?.trim());
  if (auth0) return null;
  const secret = env.jwtSecret?.trim() ?? "";
  if (secret.length === 0 || PUBLIC_JWT_SECRETS.includes(secret)) {
    return "Set AUTH0_ISSUER and AUTH0_AUDIENCE (or a private JWT_SECRET). The public dev JWT secret is only allowed with NODE_ENV=development or test.";
  }
  return null;
}

export function validateAuthEnv(env: AuthEnv = readAuthEnv()): void {
  const problem = authEnvProblem(env);
  if (problem) throw new Error(problem);
}
