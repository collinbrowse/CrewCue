# Auth0 + Social IdP setup runbook (CrewCue onboarding)

This runbook covers the remaining authentication setup needed for the production onboarding flow:

- Mobile Auth0 sign in/sign up with Google, Apple, and Email
- Auth0 audience alignment with the API
- Staging-first tenant setup and verification

## 1) Preconditions

1. Install Terraform \(>=1.6\) and authenticate for Auth0 Management API access.
2. Confirm the app uses these callback and deep-link values:
   - `crewcue://auth`
3. Ensure the mobile environment has these non-secret values:
   - `EXPO_PUBLIC_AUTH0_DOMAIN`
   - `EXPO_PUBLIC_AUTH0_CLIENT_ID`
   - `EXPO_PUBLIC_AUTH0_AUDIENCE`
   - `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE`
   - `EXPO_PUBLIC_AUTH0_CONNECTION_APPLE`
   - `EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL`

## 2) Apply Auth0 Terraform staging baseline

Terraform files:
- `infra/terraform/auth0/staging/main.tf`
- `infra/terraform/auth0/staging/variables.tf`

From repo root:

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

Capture outputs from Auth0 dashboard afterward:
- Native app client ID for CrewCue mobile
- Final API audience if overridden

## 3) Bootstrap Auth0 client settings through Management API script

This script updates callback/logout/origin settings for the mobile client.

```bash
cd "/Users/collinbrowse/Documents/After College/Personal Development/CrewCue" && \
AUTH0_DOMAIN="YOUR_TENANT.us.auth0.com" \
AUTH0_MGMT_CLIENT_ID="YOUR_M2M_CLIENT_ID" \
AUTH0_MGMT_CLIENT_SECRET="YOUR_M2M_CLIENT_SECRET" \
AUTH0_MOBILE_CLIENT_ID="YOUR_CREWCUE_MOBILE_CLIENT_ID" \
npm run auth0:bootstrap-mobile-client
```

## 4) Google sign-in setup (manual)

1. Open Google Cloud Console and select the staging project.
2. Configure OAuth consent screen (app name, support email, test users for staging).
3. Create OAuth client credentials required by your Auth0 Google social connection.
4. In Auth0 Dashboard, open the Google social connection and paste client ID/secret.
5. Enable that connection for the CrewCue mobile app.
6. Set `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE` to the exact Auth0 connection name.

## 5) Apple sign-in setup (manual)

1. Open Apple Developer and enable Sign in with Apple for the staging app identifier.
2. Create a Services ID and private key for the Auth0 Apple connection.
3. Configure Apple return URLs/domains exactly as required by Auth0 Apple docs.
4. In Auth0 Dashboard, configure the Apple connection with key ID, team ID, and private key.
5. Enable Apple connection for CrewCue mobile app.
6. Set `EXPO_PUBLIC_AUTH0_CONNECTION_APPLE` to the exact Auth0 connection name.

## 6) Email sign-in setup (manual)

1. In Auth0, configure a database connection for email/password (for example `Username-Password-Authentication`).
2. Enable the connection for CrewCue mobile app.
3. Set `EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL` to that exact connection name.

## 7) CI + local environment variable wiring

1. Update local `apps/mobile/.env` from `apps/mobile/.env.example`.
2. In CI secret manager / GitHub Actions, set:
   - `EXPO_PUBLIC_AUTH0_DOMAIN`
   - `EXPO_PUBLIC_AUTH0_CLIENT_ID`
   - `EXPO_PUBLIC_AUTH0_AUDIENCE`
   - `EXPO_PUBLIC_AUTH0_CONNECTION_GOOGLE`
   - `EXPO_PUBLIC_AUTH0_CONNECTION_APPLE`
   - `EXPO_PUBLIC_AUTH0_CONNECTION_EMAIL`
3. For automation jobs that call Auth0 Management API, set:
   - `AUTH0_DOMAIN`
   - `AUTH0_MGMT_CLIENT_ID`
   - `AUTH0_MGMT_CLIENT_SECRET`
   - `AUTH0_MOBILE_CLIENT_ID`

## 8) Verification checklist (staging first)

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

## 9) Production rollout notes

1. Repeat setup for production tenant after staging soak.
2. Keep connection names consistent across staging and production or document environment-specific values.
3. Do not commit secrets into git; use CI/secret manager only.
