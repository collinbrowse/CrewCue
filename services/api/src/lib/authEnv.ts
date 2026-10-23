/** The HS256 fallback secret in `plugins/auth.ts`. It is public, so production must never verify with it. */
export const DEV_JWT_SECRET = "dev-only-secret";

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
 * Returns a startup error when production would accept tokens signed with the public dev secret.
 * Production with Auth0 configured never uses the HS256 path, so any JWT_SECRET is fine there.
 */
export function authEnvProblem(env: AuthEnv): string | null {
  if (env.nodeEnv !== "production") return null;
  const auth0 = Boolean(env.auth0Issuer?.trim() && env.auth0Audience?.trim());
  if (auth0) return null;
  const secret = env.jwtSecret?.trim() ?? "";
  if (secret.length === 0 || secret === DEV_JWT_SECRET) {
    return "NODE_ENV=production needs AUTH0_ISSUER and AUTH0_AUDIENCE (or a private JWT_SECRET). Refusing the public dev JWT secret.";
  }
  return null;
}

export function validateAuthEnv(env: AuthEnv = readAuthEnv()): void {
  const problem = authEnvProblem(env);
  if (problem) throw new Error(problem);
}
