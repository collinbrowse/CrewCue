# Strava OAuth setup (W3-2)

Staging-first athlete history sync. Secrets stay on the API; mobile never receives `STRAVA_CLIENT_SECRET`.

## 1) Create a Strava API application

1. Open [Strava API settings](https://www.strava.com/settings/api).
2. Create an application (or use an existing staging app).
3. Note **Client ID** and **Client Secret**.
4. Set **Authorization Callback Domain** to your API host (no path), e.g.:

   - `crewcue-staging.up.railway.app`

   Strava only allows **http/https** redirect URIs on that domain (not custom URL schemes like `crewcue://`).

## 2) Place secrets (never commit)

| Location | Vars |
| --- | --- |
| Repo-root `.env.local` / `.env.staging` | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI` |
| Railway staging dashboard | Same three vars for the deployed API |

**Staging redirect URI (required):**

```bash
STRAVA_REDIRECT_URI=https://crewcue-staging.up.railway.app/strava/oauth/redirect
```

**Local API against Strava (optional):**

```bash
STRAVA_REDIRECT_URI=http://127.0.0.1:4000/strava/oauth/redirect
```

Use the same host in Strava **Authorization Callback Domain** (`127.0.0.1` or your Railway host).

Templates (empty placeholders): `.env.local.example`, `.env.staging.example`.

## 3) Scopes

Authorize URL requests `read,activity:read_all` with `approval_prompt=force` so reconnect always shows consent (needed to upgrade a prior weak grant). Callback rejects connects that omit activity read scopes.

If your Strava app is limited to public activities only, set the API client scope override to `read,activity:read` (code default still requests `activity:read_all`).

### Troubleshooting sync `403`

`Strava activities request failed (403)` means the access token lacks `activity:read` / `activity:read_all` (Strava often reports `activity:read_permission missing`).

1. Disconnect in CrewCue (after [#440](https://github.com/collinbrowse/CrewCue/pull/440) merges, this also revokes at Strava).
2. Connect again — leave **View data about your private activities** checked.
3. Sync again. If the error includes Strava’s detail string, that confirms the scope gap.

## 4) Flow (product)

1. Mobile calls `GET /strava/oauth/start` → `{ authorizeUrl, state, redirectUri }`.
2. Opens `authorizeUrl` in the system browser; **`redirectUri` in the response is the Strava-registered HTTPS URL** (not passed to `openAuthSessionAsync`).
3. Strava redirects to `…/strava/oauth/redirect?code=…&state=…`.
4. API immediately **302 redirects** to `crewcue://strava?code=…&state=…` so the auth session auto-closes on iOS.
5. Mobile posts `POST /strava/oauth/callback` with `code` + `state`.
6. Mobile calls `POST /strava/sync` to upsert history rows.
7. Sync pulls **~1 year** of Strava activities (paginated), keeps **Run / TrailRun / VirtualRun** only (every distance), and upserts into activity history for pacing estimates.

## 5) Troubleshooting “Not connected”

- **Railway `STRAVA_REDIRECT_URI` must be HTTPS** on your API host, not `crewcue://strava`.
- Strava **Authorization Callback Domain** must match that host.
- After Connect, Profile should show a red error line if token exchange failed (check Railway logs).
- Redeploy API after changing env vars.

## 6) Production

Do not enable production Strava until staging OAuth + sync has soaked (staging-first cloud rule).
