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
6. Record the **exact Auth0 connection name** for Google (often `google-oauth2`). The native apps need it as their Google connection value.

## 6) Apple sign-in setup (manual)

1. Open Apple Developer and enable Sign in with Apple for the staging app identifier.
2. Create a Services ID and private key for the Auth0 Apple connection.
3. Configure Apple return URLs/domains exactly as required by Auth0 Apple docs.
4. In Auth0 Dashboard, configure the Apple connection with key ID, team ID, and private key.
5. Enable Apple connection for CrewCue mobile app.
6. Record the exact Auth0 connection name for Apple.

## 7) Email sign-in setup (manual)

1. In Auth0, configure a database connection for email/password (for example `Username-Password-Authentication`).
2. Enable the connection for CrewCue mobile app.
3. Record that exact connection name for email.

## 8) Environment wiring

Native app config (Auth0 domain, client id, audience, connection names, API base URL) is not wired yet. The in-progress design is on branch `wip/native-product-shell`: `apps/ios/CrewCue/Config/CrewCueConfig.plist` and `apps/android/app/src/main/assets/crewcue.config.properties`, both gitignored and copied from `*.example`.

API Auth0 verify (root `.env` profiles, Railway variables in deployed environments):

- `AUTH0_ISSUER` = `https://<auth0-domain>/` (trailing slash)
- `AUTH0_AUDIENCE` = the Auth0 API identifier. It must match the audience the apps request.

If either is missing, the API falls back to HS256 `JWT_SECRET` tokens and rejects Auth0 access tokens.

Bootstrap and automation only (never ship these in an app): `AUTH0_DOMAIN`, `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`, `AUTH0_MOBILE_CLIENT_ID`.

Local API against staging Auth0: `npm run env:init`, set `AUTH0_ISSUER` / `AUTH0_AUDIENCE` in `.env.local` to the staging tenant, then `npm run env:local` and `npm run dev:api`. The iOS Simulator reaches the API at `http://127.0.0.1:4000`, the Android emulator at `http://10.0.2.2:4000`.

### Optional: dedicated Auth0 development tenant

Create a tenant and API (audience e.g. `https://api.crewcue.local`), add a native app with `crewcue://auth` callbacks, enable the connections, and point both the app config and `.env.local` at it.

## 9) Verification checklist (staging first)

1. Run repo validation:
  ```bash
   npm run verify
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

