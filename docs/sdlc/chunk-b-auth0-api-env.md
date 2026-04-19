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

## Railway (staging) — what “set the variables” actually means

You are wiring **two products** together: **Auth0** mints JWTs; **Railway** runs the API and needs the same `iss` / `aud` (and custom claims) the tokens use.

### A. Get values from Auth0 (once per environment, e.g. “Staging”)

1. **Create a tenant** (or use an existing dev tenant). Your issuer looks like  
   `https://<something>.us.auth0.com/` (exact trailing slash can matter — match a real token).
2. **APIs → Create API** (Resource Server).  
   - Set **Identifier** to something stable, e.g. `https://api.crewcue.dev` or `https://crewcue-staging-api`.  
   - That string (or the “Identifier” field exactly as shown) is your **`AUTH0_AUDIENCE`**.
3. **Applications → Create** (Native or SPA for Expo/mobile, or Machine-to-Machine only if you are just testing with scripts).  
4. **APIs → your API → Machine to Machine / Test** tab: ensure the app is **authorized** to call this API so issued access tokens include this API as **`aud`**.
5. **Actions → Flows → Login** (or “Credentials / Password” / “Token” flows per Auth0 UI): add a **custom Action** that runs when an access token is issued and sets custom claims the CrewCue API expects, for example:
   - `team_ids` — array of team id strings (can be `[]` while bootstrapping).
   - `room_roles` — object map `roomId → role` with values `athlete` | `crew_member` | `crew_chief` | `team_manager` (can be `{}` while bootstrapping).  
   Use Auth0’s `api.accessToken.setCustomClaim('team_ids', …)` style APIs (exact API depends on Action type; Auth0 docs: “Add custom claims to access tokens”).
6. **Decode a test access token** (jwt.io, Auth0 dashboard test, or `curl` with client credentials) and copy **`iss` exactly** → that is **`AUTH0_ISSUER`**. Confirm **`aud`** equals your API identifier.

Until `team_ids` and `room_roles` exist on the **access** token, the API will verify the JWT but then **drop identity** (same as “unauthenticated”) because of the strict claim rules above.

### B. Put those values on Railway (your API service)

1. Railway → your **project** → select the **API** service (not Postgres).
2. **Variables** (or **Settings → Variables**).
3. **Add** (or edit):
   - `AUTH0_ISSUER` = paste `iss` from a real access token (string-for-string match).
   - `AUTH0_AUDIENCE` = your API **Identifier** from Auth0.
   - Optional: `AUTH0_CLAIM_NAMESPACE` only if you put claims under a namespace like `https://crewcue.dev/` instead of top-level `team_ids` / `room_roles`.
4. **Save**, then **Deploy** (or redeploy) so the new env is picked up.

Railway does **not** create Auth0 for you — it only injects strings into the Node process. If either `AUTH0_ISSUER` or `AUTH0_AUDIENCE` is missing, the API **stays on HS256** dev tokens (`JWT_SECRET`), which is why “nothing changed” until both are set.

### C. Quick sanity check after deploy

Call any protected route with `Authorization: Bearer <access_token>` from Auth0. If you get **401** where you expected auth, decode the token: either `iss`/`aud` mismatch with Railway vars, or `team_ids` / `room_roles` missing from the access token payload.
