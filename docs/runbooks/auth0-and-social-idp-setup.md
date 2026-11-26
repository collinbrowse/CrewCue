# Auth0 sign-in methods (Google, Apple, email)

How to set up each sign-in method in the Auth0 tenant. Staging and production share one tenant, so each method is set up once and then switched on per application. The API, the applications, callback URLs and the values each environment reads are in step 4 of [launch-owner-setup.md](launch-owner-setup.md).

## 1) Google sign-in setup (manual)

1. Open Google Cloud Console and select the staging project.
2. Configure OAuth consent screen (app name, support email, test users for staging).
3. Create OAuth client credentials required by your Auth0 Google social connection.
4. In Auth0 Dashboard, open the Google social connection and paste client ID/secret.
5. Enable that connection for the CrewCue mobile app.
6. Record the **exact Auth0 connection name** for Google (often `google-oauth2`). The native apps need it as their Google connection value.

## 2) Apple sign-in setup (manual)

1. Open Apple Developer and enable Sign in with Apple for the staging app identifier.
2. Create a Services ID and private key for the Auth0 Apple connection.
3. Configure Apple return URLs/domains exactly as required by Auth0 Apple docs.
4. In Auth0 Dashboard, configure the Apple connection with key ID, team ID, and private key.
5. Enable Apple connection for CrewCue mobile app.
6. Record the exact Auth0 connection name for Apple.

## 3) Email sign-in setup (manual)

1. In Auth0, configure a database connection for email/password (for example `Username-Password-Authentication`).
2. Enable the connection for CrewCue mobile app.
3. Record that exact connection name for email.
4. Say plainly when an email already has an account. By default, signing up with a registered email shows "Something went wrong, please try again later" (error code `auth0-users-validation`), which reads like an outage. Branding → Universal Login → Custom Text: prompt `signup`, screen `signup`, language English. Set these two keys and save:
   ```json
   {
     "auth0-users-validation": "An account with this email may already exist. Tap Log in, or reset your password.",
     "email-in-use": "An account with this email already exists. Tap Log in instead."
   }
   ```
   Trade-off: anyone can tell whether an email has an account. Accepted for CrewCue (2026-11-20). Do this on every tenant, production included.

## 4) Environment wiring

Native app config (Auth0 domain, client id, audience, connection names, API base URL) is not wired yet. The in-progress design is on branch `wip/native-product-shell`: `apps/ios/CrewCue/Config/CrewCueConfig.plist` and `apps/android/app/src/main/assets/crewcue.config.properties`, both gitignored and copied from `*.example`.

API Auth0 verify (root `.env` profiles, Railway variables in deployed environments):

- `AUTH0_ISSUER` = `https://<auth0-domain>/` (trailing slash)
- `AUTH0_AUDIENCE` = the Auth0 API identifier. It must match the audience the apps request.

If either is missing, the API falls back to HS256 `JWT_SECRET` tokens and rejects Auth0 access tokens.

Local API against staging Auth0: `npm run env:init`, set `AUTH0_ISSUER` / `AUTH0_AUDIENCE` in `.env.local` to the staging tenant, then `npm run env:local` and `npm run dev:api`. The iOS Simulator reaches the API at `http://127.0.0.1:4000`, the Android emulator at `http://10.0.2.2:4000`.

## 5) Verification checklist (staging first)

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

## 6) Production rollout notes

1. Production shares the staging tenant, with its own API and application: follow step 4 of [launch-owner-setup.md](launch-owner-setup.md).
2. Keep connection names consistent across staging and production or document environment-specific values.
3. Do not commit secrets into git; use CI/secret manager only.
