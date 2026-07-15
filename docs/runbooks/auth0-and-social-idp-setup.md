# Auth0 + Social IdP setup runbook (CrewCue onboarding)

This runbook covers the remaining authentication setup needed for the production onboarding flow:

- Mobile Auth0 sign in/sign up with Google, Apple, and Email
- Auth0 audience alignment with the API
- Staging-first tenant setup and verification

## 1) Preconditions

1. **Terraform is optional for now.** You can configure tenants entirely in the Auth0 Dashboard; Terraform under `infra/terraform/auth0/staging/` remains available when you want repeatable infra-as-code again.
2. Confirm the app uses these callback and deep-link values:
  - `crewcue://auth`
3. Ensure the mobile environment has these non-secret values:
  - `EXPO_PUBLIC_AUTH0_DOMAIN`
  - `EXPO_PUBLIC_AUTH0_CLIENT_ID`
  - `EXPO_PUBLIC_AUTH0_AUDIENCE`
  - `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE`
  - `EXPO_PUBLIC_AUTH0_CONNECTION_APPLE`
  - `EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL`

## 2) Optional: Terraform staging baseline (defer if using Dashboard-only setup)

Terraform files:

- `infra/terraform/auth0/staging/main.tf`
- `infra/terraform/auth0/staging/variables.tf`

Skip this section until you bring Terraform back; instead create your API, native mobile application, and Machine-to-Machine application in the Auth0 Dashboard and note IDs from **Applications** and **APIs**.

From repo root (when ready):

```bash
cd "/Users/collinbrowse/Documents/After College/Personal Development/CrewCue/infra/terraform/auth0/staging" && terraform init
```

```bash
cd "/Users/collinbrowse/Documents/After College/Personal Development/CrewCue/infra/terraform/auth0/staging" && terraform apply \
  -var="auth0_domain=YOUR_TENANT.us.auth0.com" \
  -var="auth0_management_client_id=YOUR_M2M_CLIENT_ID" \
  -var="auth0_management_client_secret=YOUR_M2M_CLIENT_SECRET" \
  -var="api_audience=https://crewcue-staging-api"
```

## 3) Authorize the Management API client (required before bootstrap)

The bootstrap script calls the Auth0 Management API using your **Machine to Machine** application (`AUTH0_MGMT_CLIENT_`*). Until Auth0 creates the corresponding **client grant**, token exchange responds with `access_denied` and mentions needing a grant for `…/api/v2/`.

1. Auth0 Dashboard → **Applications** → **APIs** → open **Auth0 Management API**.
2. Under **Machine to Machine Applications**, find your M2M app and **authorize** it (toggle on).
3. Grant at least `**read:clients`** and `**update:clients`** (that matches what `scripts/auth0/bootstrap-connection-config.mjs` needs when PATCHing the mobile client).

After saving, retry the bootstrap command.

### Troubleshooting: `Failed to fetch Auth0 management token`

If the error mentions **not authorized** for resource server `https://YOUR_TENANT.auth0.com/api/v2/`:

- Confirm step (3) above: the M2M app must have an explicit grant to **Auth0 Management API**, not only “Allowed Callback URLs” on the application itself.

If you pasted an M2M **client secret** anywhere unsafe (chat, screenshots), **rotate** it in Auth0 (**Applications** → your M2M app → **Credentials**) and update any env vars or CI secrets that referenced the old secret.

## 4) Bootstrap Auth0 client settings through Management API script

This script updates callback/logout/origin settings for the mobile client.

```bash
cd "/Users/collinbrowse/Documents/After College/Personal Development/CrewCue" && \
AUTH0_DOMAIN="YOUR_TENANT.us.auth0.com" \
AUTH0_MGMT_CLIENT_ID="YOUR_M2M_CLIENT_ID" \
AUTH0_MGMT_CLIENT_SECRET="YOUR_M2M_CLIENT_SECRET" \
AUTH0_MOBILE_CLIENT_ID="YOUR_CREWCUE_MOBILE_CLIENT_ID" \
npm run auth0:bootstrap-mobile-client
```

## 5) Google sign-in setup (manual)

1. Open Google Cloud Console and select the staging project.
2. Configure OAuth consent screen (app name, support email, test users for staging).
3. Create OAuth client credentials required by your Auth0 Google social connection.
4. In Auth0 Dashboard, open the Google social connection and paste client ID/secret.
5. Enable that connection for the CrewCue mobile app.
6. Set `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE` locally to the **exact Auth0 connection name** for Google:
  - Copy `apps/mobile/.env.example` to `apps/mobile/.env` (gitignored).
  - Set `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE=` to that string (often `google-oauth2` if you did not rename the connection).
  - Expo reads `EXPO_PUBLIC_`* at dev/build time; see `apps/mobile/src/config.ts`.

## 6) Apple sign-in setup (manual)

1. Open Apple Developer and enable Sign in with Apple for the staging app identifier.
2. Create a Services ID and private key for the Auth0 Apple connection.
3. Configure Apple return URLs/domains exactly as required by Auth0 Apple docs.
4. In Auth0 Dashboard, configure the Apple connection with key ID, team ID, and private key.
5. Enable Apple connection for CrewCue mobile app.
6. Set `EXPO_PUBLIC_AUTH0_CONNECTION_APPLE` to the exact Auth0 connection name.

## 7) Email sign-in setup (manual)

1. In Auth0, configure a database connection for email/password (for example `Username-Password-Authentication`).
2. Enable the connection for CrewCue mobile app.
3. Set `EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL` to that exact connection name.

## 8) CI + local environment variable wiring

1. **Local / staging profiles (recommended):**
  - Once: `npm run env:init` (seeds `apps/mobile/.env.{local,staging}` and root `.env.{local,staging}` from your active files, or from `*.example`).
  - Switch: `npm run env:local` or `npm run env:staging` (copies the profile onto active `.env` files).
  - Check: `npm run env:status` (warns if mobile audience ≠ API `AUTH0_AUDIENCE`).
  - Restart Metro and the API after switching — env is read at process start.
2. **GitHub Actions:** This repo’s PR/`main` CI (`.github/workflows/ci.yml`) uses **placeholder** `EXPO_PUBLIC_`* values so `expo export` stays deterministic; it does **not** talk to your real Auth0 tenant. You cannot grant an assistant remote access to set secrets on your GitHub org—add them yourself under **Repo → Settings → Secrets and variables → Actions** if you add a workflow that builds against staging (for example EAS Build invoked from Actions).
3. **EAS / production-like mobile builds:** Configure the same `EXPO_PUBLIC_`* keys as **EAS environment variables** or **EAS Secrets** for the profile that ships staging/production binaries—those override `.env` for hosted builds.
4. Variables to mirror across local profiles, EAS, and any deploy workflow:
  - `EXPO_PUBLIC_AUTH0_DOMAIN`
  - `EXPO_PUBLIC_AUTH0_CLIENT_ID`
  - `EXPO_PUBLIC_AUTH0_AUDIENCE`
  - `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE`
  - `EXPO_PUBLIC_AUTH0_CONNECTION_APPLE`
  - `EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL`
5. **API Auth0 verify (root `.env` / profiles)** — must stay aligned with mobile:
  - `AUTH0_ISSUER` = `https://{EXPO_PUBLIC_AUTH0_DOMAIN}/` (trailing slash)
  - `AUTH0_AUDIENCE` = same string as `EXPO_PUBLIC_AUTH0_AUDIENCE`
6. **Bootstrap / automation only** (never bundle these into the mobile app):
  - `AUTH0_DOMAIN`
  - `AUTH0_MGMT_CLIENT_ID`
  - `AUTH0_MGMT_CLIENT_SECRET`
  - `AUTH0_MOBILE_CLIENT_ID`

From a machine already logged into GitHub CLI (`gh auth login`), you can set an Actions secret locally:
`gh secret set AUTH0_MGMT_CLIENT_SECRET --repo OWNER/REPO`

## 8b) Local API + Auth0 sync

There is no separate “Auth0 running on localhost.” Local means: **mobile talks to your local API**, while **login still uses Auth0 (usually the staging tenant)**.

### Recommended: reuse staging Auth0 against local API

1. Keep the same mobile Auth0 values in `apps/mobile/.env.local` as staging (`DOMAIN`, `CLIENT_ID`, `AUDIENCE`, connection names).
2. Set only the API URL differently:
   - Local: `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000` (iOS Simulator)
   - Android emulator: `http://10.0.2.2:4000`
3. On the **API** local profile (root `.env.local`), set:
   - `AUTH0_ISSUER=https://<same-domain-as-mobile>/`
   - `AUTH0_AUDIENCE=<same-as-EXPO_PUBLIC_AUTH0_AUDIENCE>`
4. `npm run env:init` does steps 2–3 for you when seeding from an existing mobile `.env`.
5. `npm run env:local` → start API (`npm run dev:api` or `dev:api:memory`) → restart Metro.

If `AUTH0_ISSUER` / `AUTH0_AUDIENCE` are missing on the API, it falls back to HS256 `JWT_SECRET` tokens and **will not accept Auth0 access tokens** from the app.

### Auth0 Dashboard checks (staging tenant is fine for local)

1. Native app **Allowed Callback URLs** include `crewcue://auth`.
2. **Allowed Logout URLs** / **Allowed Origins** include any Expo / simulator origins you use.
3. API identifier (audience) in Auth0 **APIs** matches `EXPO_PUBLIC_AUTH0_AUDIENCE` / `AUTH0_AUDIENCE` exactly.
4. No need for a second Auth0 tenant unless you want isolation from staging users.

### Optional: dedicated Auth0 “Development” tenant

Only if you want local traffic fully isolated from staging:

1. Create a new Auth0 tenant + API (audience e.g. `https://api.crewcue.local`).
2. Create a native app with `crewcue://auth` callbacks; enable Google/Apple/Email connections.
3. Put that tenant’s domain/client/audience in **both** `apps/mobile/.env.local` and root `.env.local` (`AUTH0_ISSUER` / `AUTH0_AUDIENCE`).
4. Keep `apps/mobile/.env.staging` on the staging tenant unchanged.

## 9) Verification checklist (staging first)

1. Run repo validation:
  ```bash
   cd "/Users/collinbrowse/Documents/After College/Personal Development/CrewCue" && npm run verify
  ```
2. In mobile app, verify:
  - Landing screen shows Sign up / Sign back in / Join with code
  - Sign up with Google, Apple, Email all reach Auth0 and return
  - Join-by-code flow: page 1, page 2 preview, page 3 account creation
  - One-time notifications gate appears after signup/join and not again on same device
3. Verify API token audience acceptance by checking authenticated calls succeed after login.
4. Verify returning users skip onboarding due to stored token restore.

## 10) Production rollout notes

1. Repeat setup for production tenant after staging soak.
2. Keep connection names consistent across staging and production or document environment-specific values.
3. Do not commit secrets into git; use CI/secret manager only.

