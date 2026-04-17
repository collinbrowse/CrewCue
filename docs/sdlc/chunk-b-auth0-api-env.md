# Chunk B — Auth0 environment variables (API)

**Audience:** operators configuring **staging** or **production** on Railway (or any host) for `@crewcue/api`.  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk B, staging-first).

## When Auth0 is enabled

Set **both** of the following on the API service. If either is missing, the API stays on **development HS256** tokens (`JWT_SECRET` + `@fastify/jwt`), which is what local runs and CI use.

| Variable | Required | Description |
| --- | --- | --- |
| `AUTH0_ISSUER` | Yes (with Auth0) | Must match the JWT `iss` claim exactly (copy from a decoded test token), e.g. `https://YOUR_TENANT.us.auth0.com/`. |
| `AUTH0_AUDIENCE` | Yes (with Auth0) | API identifier; must match JWT `aud` (string or one of the audiences in the token). |
| `AUTH0_CLAIM_NAMESPACE` | No | If set, custom claims are also read from namespaced keys `${namespace}team_ids` and `${namespace}room_roles` (namespace may include or omit a trailing `/`). |

## Claim mapping

After JWKS verification, the access token payload is mapped to `IdentityClaims`:

- `sub` (required)
- `email` (optional)
- **Team membership** — the token must include a team list under `teamIds`, `team_ids`, or namespaced variants (`[]` is valid).
- **Room roles** — the token must include a map under `roomRoles`, `room_roles`, or namespaced variants (`{}` is valid). Each value must be one of `athlete`, `crew_member`, `crew_chief`, `team_manager`.

If either claim is missing, or `roomRoles` contains an invalid role string, the whole identity is rejected (request is treated as unauthenticated).

## JWT secret

`JWT_SECRET` is still used for the HS256 path when Auth0 env is **not** configured. When Auth0 **is** configured, incoming bearer tokens are **only** verified as Auth0 access tokens (no HS256 fallback on that deployment).

## Auth0 dashboard checklist (high level)

1. Create an API (Resource Server) and note the **identifier** → `AUTH0_AUDIENCE`.
2. Create an Application (SPA / Native) for the client.
3. Authorize the application for that API so access tokens include the correct `aud`.
4. Add an **Action** (or legacy rule) to embed `team_ids` / `room_roles` (or namespaced equivalents) in the access token if they are not already present.
