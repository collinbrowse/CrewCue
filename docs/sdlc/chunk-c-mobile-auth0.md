# Chunk C — Mobile Auth0 login against staging API

**Audience:** operators + engineers wiring the Expo mobile app to the Railway staging API with Auth0 login.  
**Strategy:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) (Chunk C, staging-first).  
**Related:** [chunk-b-auth0-api-env.md](./chunk-b-auth0-api-env.md) (how the API verifies the same token).

---

## 1. What this slice is

First slice of Chunk C:

1. Launch the Expo app → tap **Sign in with Auth0**.
2. Auth0 Universal Login in the system browser.
3. App receives an authorization code, exchanges it for an access token, stores the token in `expo-secure-store`.
4. App calls `POST /race-rooms` on the Railway API with the Bearer token and displays the new room id.

That is the whole acceptance criterion for this slice — no navigation stack, no polished UI, no offline behavior.

---

## 2. Files touched

| Path | Purpose |
| --- | --- |
| `apps/mobile/src/config.ts` | Reads `EXPO_PUBLIC_*` env vars and validates they are all set. |
| `apps/mobile/src/auth/useAuth.ts` | `expo-auth-session` Authorization Code + PKCE flow against Auth0. |
| `apps/mobile/src/auth/tokenStorage.ts` | Persists access/refresh/id tokens in `expo-secure-store`. |
| `apps/mobile/src/auth/jwt.ts` | Local payload decode (display only — no signature check). |
| `apps/mobile/src/api/client.ts` | `fetch`-based API client that attaches the Bearer token. |
| `apps/mobile/App.tsx` | Single-screen shell: sign in → show claims → create room. |
| `apps/mobile/.env.example` | Template env file (copy to `.env`). |

---

## 3. Configure Auth0 (native application)

In the Auth0 dashboard (same tenant you used for Chunk B):

1. **Applications → Create Application**
   - Name: `CrewCue Mobile Staging` (or similar).
   - Type: **Native**.
2. Note the **Client ID** — this becomes `EXPO_PUBLIC_AUTH0_CLIENT_ID`.
3. **Applications → your mobile app → APIs** tab: authorize it for the same **API Identifier** the backend verifies (`AUTH0_AUDIENCE`).
4. **Allowed Callback URLs / Allowed Logout URLs**: add the redirect URI the app logs to the screen on first run (it is printed as **Redirect URI** on the root card). Typical patterns:
   - Dev build / production build: `crewcue://auth`
   - Expo Go (optional, older proxy flow): `exp://HOST:PORT/--/auth` — prefer a dev build.
5. **Actions → Triggers → Post Login**: create (or reuse) an Action that embeds the CrewCue custom claims so the API will resolve an identity for human logins:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const teamIds = event.user.app_metadata?.team_ids ?? [];
     const roomRoles = event.user.app_metadata?.room_roles ?? {};
     api.accessToken.setCustomClaim("team_ids", teamIds);
     api.accessToken.setCustomClaim("room_roles", roomRoles);
   };
   ```

   If you prefer a namespace, use `https://crewcue.dev/team_ids` / `https://crewcue.dev/room_roles` and also set `AUTH0_CLAIM_NAMESPACE=https://crewcue.dev/` on the API service.

> Until this Post Login action runs, the API will verify the JWT signature but still reject the identity (per the strict rules in `services/api/src/lib/authIdentity.ts`) because `team_ids` / `room_roles` are missing. Empty array and empty object are valid — they just cannot be absent.

---

## 4. Configure the mobile app

1. `cp apps/mobile/.env.example apps/mobile/.env`
2. Fill in:

   | Variable | Value |
   | --- | --- |
   | `EXPO_PUBLIC_AUTH0_DOMAIN` | your Auth0 tenant domain without scheme (e.g. `dev-abc.us.auth0.com`) |
   | `EXPO_PUBLIC_AUTH0_CLIENT_ID` | the Native app's client id |
   | `EXPO_PUBLIC_AUTH0_AUDIENCE` | exact string used for the API `AUTH0_AUDIENCE` |
   | `EXPO_PUBLIC_API_BASE_URL` | Railway API URL, no trailing slash |

3. Install native modules once (Expo managed workflow):

   ```bash
   npm install -w @crewcue/mobile
   ```

4. Start Expo:

   ```bash
   npm run dev -w @crewcue/mobile
   ```

5. Run in a **dev build** or the iOS/Android simulator for best results. Expo Go can work in some setups but is explicitly not recommended by Expo for OAuth in newer SDKs.

---

## 5. Validating end to end (staging)

1. Open the app. The screen shows the computed **Redirect URI**. Copy it and confirm it is in the Auth0 Allowed Callback URLs.
2. Tap **Sign in with Auth0**. Log in with a test user in your tenant.
3. After login, the card shows your `sub`, `email`, `team_ids`, and `room_roles`. If either of the custom claim rows is `null`, your Post Login action is not firing for this connection/app — re-check step 3.5 above.
4. Tap **Create race room (staging)**. The card displays the returned room id and its entitlement status (`unpaid` by default — this matches Chunk B behavior).
5. To verify further, use `curl` with the same access token (printed in logs via `adb logcat` / Xcode if needed) and call `POST /race-rooms/<roomId>/entitlement` with `{ "status": "paid" }`, then `GET /race-rooms/<roomId>`.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Configuration missing` screen | `.env` missing or keys misspelled | Copy `.env.example` and re-run `npm run dev -w @crewcue/mobile` (Expo reads `.env` at start). |
| Browser opens but returns an Auth0 error page | Callback URL not in Auth0 app | Copy the exact **Redirect URI** the app shows into Allowed Callback URLs. |
| Login succeeds but `API error 401 Unauthorized` | API does not recognize the identity | Usually missing `team_ids` / `room_roles` on the access token. Fix the Post Login action. |
| `API error 402 Entitlement unpaid` | Correct — new rooms are `unpaid` | Call `POST /race-rooms/:id/entitlement` with `{"status":"paid"}` using the same token to continue the smoke flow. |
| Browser closes immediately / PKCE failure | Expo Go proxy limitations | Use a dev build (`npx expo prebuild` + native run) or an emulator that supports the custom scheme. |

---

## 7. Revision history

| Date | Change |
| --- | --- |
| 2026-04-20 | Initial publication alongside the first Chunk C slice. |
