/**
 * Auth0 Management API: delete the signed-in user's identity on account deletion (#560).
 *
 * Owner config (Railway variables, see docs/release/account-deletion.md):
 *   AUTH0_MGMT_DOMAIN         tenant domain, e.g. crewcue.us.auth0.com
 *   AUTH0_MGMT_CLIENT_ID      Machine-to-Machine app authorized for the Management API
 *   AUTH0_MGMT_CLIENT_SECRET  that app's secret; it needs only the `delete:users` scope
 * All three unset → deletion reports `not_configured` and leaves the Auth0 user in place.
 */

export type Auth0ManagementConfig = {
  domain: string;
  clientId: string;
  clientSecret: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class Auth0ManagementError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined
  ) {
    super(message);
    this.name = "Auth0ManagementError";
  }
}

export function readAuth0ManagementConfig(env: NodeJS.ProcessEnv = process.env): Auth0ManagementConfig | undefined {
  const domain = env.AUTH0_MGMT_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const clientId = env.AUTH0_MGMT_CLIENT_ID?.trim();
  const clientSecret = env.AUTH0_MGMT_CLIENT_SECRET?.trim();
  if (!domain || !clientId || !clientSecret) return undefined;
  return { domain, clientId, clientSecret };
}

/** Only Auth0-issued subjects (`provider|id`) can exist in the tenant; dev HS256 subjects cannot. */
export function isAuth0Subject(sub: string): boolean {
  return /^[a-z0-9-]+(-oauth2)?\|.+/i.test(sub);
}

async function fetchManagementToken(config: Auth0ManagementConfig, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(`https://${config.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: `https://${config.domain}/api/v2/`
    })
  });
  if (!res.ok) {
    throw new Auth0ManagementError(`Auth0 token request failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Auth0ManagementError("Auth0 token response had no access_token", res.status);
  }
  return body.access_token;
}

/**
 * Delete the Auth0 user. 404 counts as already deleted (idempotent replay).
 * @returns "deleted" or "already_deleted"
 */
export async function deleteAuth0User(
  config: Auth0ManagementConfig,
  sub: string,
  fetchImpl: FetchLike = fetch
): Promise<"deleted" | "already_deleted"> {
  const token = await fetchManagementToken(config, fetchImpl);
  const res = await fetchImpl(`https://${config.domain}/api/v2/users/${encodeURIComponent(sub)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return "already_deleted";
  if (!res.ok) {
    throw new Auth0ManagementError(`Auth0 delete user failed (${res.status})`, res.status);
  }
  return "deleted";
}
