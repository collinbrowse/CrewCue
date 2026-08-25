# Strava OAuth setup (W3-2)

Staging-first athlete history sync. Secrets stay on the API; mobile never receives `STRAVA_CLIENT_SECRET`.

## 1) Create a Strava API application

1. Open [Strava API settings](https://www.strava.com/settings/api).
2. Create an application (or use an existing staging app).
3. Note **Client ID** and **Client Secret**.
4. Set **Authorization Callback Domain** / redirect URI to match the API env value (default deep link):

   - `crewcue://strava`

   The exact `STRAVA_REDIRECT_URI` string must match what the API puts in the authorize URL and what Strava allows.

## 2) Place secrets (never commit)

| Location | Vars |
| --- | --- |
| Repo-root `.env.local` / `.env.staging` (via `npm run env:local` / `env:staging` → active `.env`) | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` |
| Railway staging dashboard | Same three vars for the deployed API |

Templates (empty placeholders only): `.env.local.example`, `.env.staging.example`.

## 3) Scopes

Authorize URL requests `activity:read_all` (read athlete activities including private, with consent). If your Strava app is limited to public activities only, switch the API client scope to `activity:read` and re-consent.

## 4) Flow (product)

1. Mobile calls `GET /strava/oauth/start` (Bearer Auth0/API JWT).
2. Opens returned `authorizeUrl` in the system browser.
3. Strava redirects to `crewcue://strava?code=…&state=…`.
4. Mobile posts `POST /strava/oauth/callback` with `code` + `state`.
5. Mobile calls `POST /strava/sync` to upsert `ActivityHistoryRef` rows (`source: "strava"`).

## 5) Production

Do not enable production Strava until staging OAuth + sync has soaked (staging-first cloud rule).
