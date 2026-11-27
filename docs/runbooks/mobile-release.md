# Mobile release runbook

`npm run release -- X.Y.Z` tags `main`. The `Release` workflow then:

1. Checks that every secret and build variable below exists in the `release` environment, and that the API URL is https.
2. Runs the test gate: all of CI on the tagged commit, with the iOS and Android device smoke tests always on (about 30 minutes). Nothing below starts until every job has passed.
3. Deploys the production API to Railway and checks its health.
4. Archives the iOS app and uploads it to TestFlight. Signing is cloud-managed through the App Store Connect API key, so there are no certificates or profiles to rotate by hand.
5. Builds a signed Android App Bundle and uploads it to the Google Play **internal** track.
6. Publishes a GitHub release with generated notes and the `.aab` attached.

If the gate fails, nothing has shipped. Open the failed job: a device smoke test that failed by chance passes on **Re-run failed jobs**; a real failure is fixed on `main` and released under a new tag.

Version: `X.Y.Z` becomes the iOS marketing version and the Android `versionName`. The build number (iOS) and `versionCode` (Android) are `run_number + 100`, which only ever increases.

`npm run release` refuses to tag unless you are on a clean `main` in sync with `origin`, the version is higher than the last tag, and CI on that commit is green. That check is a courtesy: green CI on `main` may have skipped the device jobs, and the workflow's own gate is what decides. `--dry-run` checks without pushing.

## One-time setup

### GitHub

`scripts/github-guardrails.sh` creates the `release` environment with the owner as required reviewer and `v*` tags as the only allowed refs ([launch-owner-setup.md](launch-owner-setup.md)). Run it first: the steps below save values into that environment.

The workflow needs ten secrets and six variables there. Every name must match exactly, in capitals.

| Name | Kind | Comes from |
| --- | --- | --- |
| `APPLE_TEAM_ID` | secret | [Apple](#apple-keys-four-secrets) |
| `ASC_KEY_ID` | secret | Apple |
| `ASC_ISSUER_ID` | secret | Apple |
| `ASC_KEY_P8_BASE64` | secret | Apple |
| `ANDROID_KEYSTORE_BASE64` | secret | [Android upload key](#android-upload-key-four-secrets) |
| `ANDROID_KEYSTORE_PASSWORD` | secret | Android upload key |
| `ANDROID_KEY_ALIAS` | secret | Android upload key |
| `ANDROID_KEY_PASSWORD` | secret | Android upload key |
| `PLAY_SERVICE_ACCOUNT_JSON` | secret | [Google Play service account](#google-play-service-account-one-secret) |
| `RAILWAY_TOKEN` | secret | [Railway](#railway-token-one-secret) |
| `CREWCUE_API_BASE_URL` and five more | variable | [Build variables](#build-variables-six-variables) |

#### How to save a value

A **secret** is hidden after you save it: GitHub never shows it again, to you or to anyone. To change one, save it again under the same name. A **variable** stays readable. Use a secret for anything that lets someone act as you (keys, passwords, tokens) and a variable for settings that ship inside the app anyway.

In the browser:

1. Open `https://github.com/collinbrowse/CrewCue/settings/environments` and click **release**.
2. Scroll to **Environment secrets** and click **Add environment secret**, or to **Environment variables** and click **Add environment variable**.
3. Type the name, paste the value, save.

Do not use **Settings → Secrets and variables → Actions → Repository secrets**. A repository secret can be read by any workflow; an environment secret only by a release you approved.

From the terminal, signed in to `gh` as yourself (not the bot). The first form asks you to paste the value, so it never lands in your shell history:

```bash
gh secret set APPLE_TEAM_ID --env release
```

```bash
gh variable set CREWCUE_API_BASE_URL --env release --body "https://crewcue-production.up.railway.app"
```

Never paste a secret into a chat with an agent, a file in this repo, or an issue. The repo is public.

#### Apple keys (four secrets)

You need the Apple Developer Program membership and the app created in App Store Connect first ([Apple](#apple), below). The key lets the workflow sign the app and upload it to TestFlight without your password.

1. [ ] **`APPLE_TEAM_ID`.** Open `https://developer.apple.com/account`, scroll to **Membership details**, and copy **Team ID**. It is 10 letters and digits, for example `A1B2C3D4E5`.
2. [ ] Open `https://appstoreconnect.apple.com/access/integrations/api` (App Store Connect → **Users and Access** → **Integrations** tab → **App Store Connect API** → **Team Keys**). The first time, click **Request Access** and accept. Only the account holder can.
3. [ ] Click **+** (Generate API Key). **Name:** `CrewCue GitHub release`. **Access:** **App Manager**. Click **Generate**. A lower role cannot create signing profiles, and the iOS job fails with "No profiles for 'com.crewcue.ios'".
4. [ ] **`ASC_ISSUER_ID`.** Copy **Issuer ID** from above the list of keys. It looks like `57246542-96fe-1a63-e053-0824d011072a` and is the same for every key in your team.
5. [ ] **`ASC_KEY_ID`.** Copy the **Key ID** from the new key's row. It is 10 letters and digits.
6. [ ] **`ASC_KEY_P8_BASE64`.** Click **Download** on the key's row. You get a file named `AuthKey_<Key ID>.p8`. **Apple lets you download it once.** Save a copy in your password manager. A secret holds one line of text and the key is a file of several lines, so it is encoded into one line (base64) first. This command encodes it and saves it in one step, with nothing copied to the clipboard:

   ```bash
   base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8 | gh secret set ASC_KEY_P8_BASE64 --env release
   ```

   To paste it in the browser instead, run `base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8 | pbcopy`, which puts the encoded text on your clipboard.
7. [ ] Delete the `.p8` from Downloads once it is in your password manager.

If the key is lost or leaked: **Revoke** it on the same page, generate a new one, and save the three `ASC_` secrets again.

#### Android upload key (four secrets)

Google Play accepts an app bundle only if it is signed with your **upload key**. You create that key yourself, as a password-protected file called a keystore. Google then re-signs the app with its own key for users (Play App Signing), so a lost upload key can be replaced through Play support, but it takes days. Back it up.

1. [ ] `keytool` creates the keystore. It comes with Java. Check that you have it:

   ```bash
   keytool -help
   ```

   If the command is not found, use the one inside Android Studio by typing `"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"` in place of `keytool` below.
2. [ ] Make a folder outside the repo, so the key can never be committed:

   ```bash
   mkdir -p ~/crewcue-keys && cd ~/crewcue-keys
   ```

3. [ ] Create the keystore:

   ```bash
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```

   It asks for:
   - **A keystore password, twice.** Make one in your password manager (at least 6 characters; avoid `$`, quotes and spaces, which get mangled on the way through the build). Nothing shows while you type.
   - **Your name, organization, city, state, country code.** These are a label inside the key and are not checked. Your name and `US` are enough; press Return to skip the rest.
   - **"Is ... correct?"** Type `yes`.

   It does not ask for a separate key password: the key uses the keystore password.
4. [ ] Save the four secrets:
   - [ ] **`ANDROID_KEYSTORE_BASE64`:** the file, encoded as for the Apple key:

     ```bash
     base64 -i ~/crewcue-keys/upload.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env release
     ```

   - [ ] **`ANDROID_KEYSTORE_PASSWORD`:** the password from step 3.
   - [ ] **`ANDROID_KEY_ALIAS`:** `upload` (the `-alias` in the command).
   - [ ] **`ANDROID_KEY_PASSWORD`:** the same password again.
5. [ ] Put `upload.jks` and its password in your password manager, as an attachment or a second copy off this Mac.

Play learns your upload key from the first bundle you upload by hand ([Google Play](#google-play), below). Sign that first bundle with this keystore, or the workflow's later uploads are rejected.

#### Google Play service account (one secret)

A service account is a robot Google account. The workflow signs in as it to upload the bundle, so your own Google password is never stored. You need the Play Console developer account and the app created first.

1. [ ] Open `https://console.cloud.google.com`, signed in with the Google account that owns the Play Console. Click the project picker at the top → **New project**. **Name:** `CrewCue Release`. Create it, then select it. This is free; no billing account is needed.
2. [ ] Left menu → **APIs & Services → Library**. Search for **Google Play Android Developer API**, open it, click **Enable**.
3. [ ] Left menu → **IAM & Admin → Service Accounts → Create service account**. **Name:** `crewcue-play-upload`. Click **Create and continue**, skip both optional steps, click **Done**. It needs no Google Cloud role.
4. [ ] Copy the account's email from the list. It looks like `crewcue-play-upload@crewcue-release-123456.iam.gserviceaccount.com`.
5. [ ] Click that email → **Keys** tab → **Add key → Create new key → JSON → Create**. A `.json` file downloads. This file is the password.
6. [ ] Open `https://play.google.com/console` → **Users and permissions → Invite new users**. Paste the email from step 4. Under **App permissions**, click **Add app**, choose CrewCue, and tick **Release apps to testing tracks**. Leave the account-wide permissions empty. Click **Invite user**. A service account is added at once; there is no invite to accept.
7. [ ] **`PLAY_SERVICE_ACCOUNT_JSON`.** Save the whole file as the secret:

   ```bash
   gh secret set PLAY_SERVICE_ACCOUNT_JSON --env release < ~/Downloads/crewcue-release-123456-abcdef123456.json
   ```

   In the browser, open the file in a text editor and paste everything, from the first `{` to the last `}`.
8. [ ] Move the `.json` into your password manager and delete it from Downloads.

New permissions can take a few hours to reach Play's upload service. An upload that fails with "The caller does not have permission" right after this setup usually passes later with no change.

#### Railway token (one secret)

The workflow deploys the production API with this token. Do [launch-owner-setup.md step 3](launch-owner-setup.md#3-railway-production-20-minutes) first, so production no longer deploys from `main`.

1. [ ] Railway → the CrewCue project → **Settings** (the project's, not your account's) → **Tokens**.
2. [ ] **Name:** `github-release`. **Environment:** **production**. Click **Create**.
3. [ ] **`RAILWAY_TOKEN`.** Copy the token, which is shown once, and save it as the secret.

A project token can deploy to that one environment and nothing else. An account token from your profile also works but can change every project you own, so do not use one. If the production service is not named `CrewCue`, add a variable `RAILWAY_PRODUCTION_SERVICE` with its name.

#### Check what you saved

- [ ] Run both commands and compare with the lists in this section:

```bash
gh secret list --env release
```

```bash
gh variable list --env release
```

The lists show names and dates, never secret values. Expect the ten secrets above and the six variables below. The first job of a release, `preflight`, also checks them and names any that are missing before anything is built or deployed.

#### Build variables (six variables)

Add these environment **variables** (not secrets). For production, the three Auth0 values are the ones from [launch-owner-setup.md step 4.7](launch-owner-setup.md#47-put-the-values-where-they-are-read), and `CREWCUE_API_BASE_URL` is the production service's address from [step 3](launch-owner-setup.md#3-railway-production-20-minutes). They pick the server and Auth0 tenant that release builds talk to. Release builds have no localhost fallback: the workflow stops if one is missing, a local Release build without them shows "CrewCue can't start", and a local `bundleRelease` or `assembleRelease` fails at configuration time.

| Variable | Value |
| --- | --- |
| `CREWCUE_API_BASE_URL` | The https API, for example the Railway staging service URL for the first test builds (`https://<staging-host>`). Then the production host. |
| `CREWCUE_AUTH0_DOMAIN` | The Auth0 tenant domain. Staging: `dev-ozh1r6603ymvszq6.us.auth0.com` |
| `CREWCUE_AUTH0_CLIENT_ID` | The Auth0 native application's client id. Staging: `oRRfHuZS7jN2pd8wn9aAwRnyay0kuzia` |
| `CREWCUE_AUTH0_AUDIENCE` | The API audience. Staging: `https://api.crewcue.staging` |
| `CREWCUE_REVENUECAT_IOS_KEY` | RevenueCat → Project → API keys → the **Apple App Store public SDK key** (`appl_…`). Public by design; it ships in the app. |
| `CREWCUE_REVENUECAT_ANDROID_KEY` | RevenueCat → Project → API keys → the **Google Play public SDK key** (`goog_…`). |

Tick each one as you save it:

- [ ] `CREWCUE_API_BASE_URL`
- [ ] `CREWCUE_AUTH0_DOMAIN`
- [ ] `CREWCUE_AUTH0_CLIENT_ID`
- [ ] `CREWCUE_AUTH0_AUDIENCE`
- [ ] `CREWCUE_REVENUECAT_IOS_KEY`
- [ ] `CREWCUE_REVENUECAT_ANDROID_KEY`

- [ ] In that Auth0 application, allow these callback and logout URLs: `crewcue://auth` (iOS, `Auth0SignIn.swift`) and `crewcue://<auth0-domain>/android/com.crewcue.android/callback` (Android, the Auth0 SDK default for the `crewcue` scheme).

To build Release locally, pass the same values: iOS as build settings (`xcodebuild … CREWCUE_API_BASE_URL=https://… CREWCUE_AUTH0_DOMAIN=…`); Android as Gradle properties (`-Pcrewcue.release.apiBaseUrl=https://… -Pcrewcue.release.auth0Domain=… -Pcrewcue.release.auth0ClientId=… -Pcrewcue.release.auth0Audience=… -Pcrewcue.release.revenuecatApiKey=goog_…`). The iOS RevenueCat key is the build setting `CREWCUE_REVENUECAT_API_KEY=appl_…`. Debug builds use a fake purchaser against the local API and need no RevenueCat key. Debug builds keep using the local API and the dev tenant (`apps/ios/Config/CrewCue.xcconfig`, `apps/android/app/src/main/res/values/strings.xml`).

Optional: Sentry crash reporting (ADR 0010, free Developer plan). Create one Sentry project per app (iOS, Android) and add to the `release` environment. Without them the apps ship with crash reporting off and the symbol upload steps skip with a warning.

| Name | Kind | Value |
| --- | --- | --- |
| `SENTRY_AUTH_TOKEN` | secret | Sentry → Settings → Auth Tokens (organization token, `project:releases` + `project:write`). Used only to upload dSYMs and R8 mappings. |
| `SENTRY_ORG` | variable | Sentry organization slug |
| `SENTRY_PROJECT_IOS` | variable | iOS project slug |
| `SENTRY_PROJECT_ANDROID` | variable | Android project slug |
| `SENTRY_DSN_IOS` | variable | iOS project DSN (Settings → Client Keys). Falls back to the repo secret `SENTRY_DSN` when unset. |
| `SENTRY_DSN_ANDROID` | variable | Android project DSN. Falls back to the repo secret `SENTRY_DSN` when unset. |

A DSN is a public client key, so a variable is fine. Debug builds never get one.

Optional variable `PLAY_RELEASE_STATUS`: set it to `draft` until the Play app has finished its first review. Play rejects `completed` releases on apps still in draft.

### Apple

1. [ ] Enroll in the Apple Developer Program.
2. [ ] Register the bundle id `com.crewcue.ios` (Identifiers) with Sign in with Apple enabled.
3. [ ] In App Store Connect, create the app with that bundle id. TestFlight internal testers see builds after processing (about 10–30 minutes).

### Google Play

1. [ ] Create the app in Play Console with package `com.crewcue.android`. Enroll in Play App Signing (default) and register the upload key above.
2. [ ] Play requires the **first** bundle to be uploaded by hand. Build it locally with the same env vars as the workflow, or take `app-release.aab` from a failed workflow run's artifacts, and upload it to Internal testing once. After that the workflow can upload.

### Billing (RevenueCat, #649)

Runners buy per race; crew never pay. Products are **consumables**; the server attaches each purchase to a race room.

| Store product id | Price | Unlocks |
| --- | --- | --- |
| `race_pass` | $14.99 | One room: runner + 1 crew |
| `crew_upgrade` | $9.99 | Unlimited crew on a room with a pass |
| `race_pass_full_crew` | $19.99 | Both |

1. [ ] App Store Connect and Play Console: create the three products as consumable in-app products with those exact ids and prices.
2. [ ] RevenueCat: create the project, add the iOS and Android apps, import the three products, and copy the two public SDK keys into the release variables above.
3. [ ] RevenueCat → Integrations → Webhooks: URL `https://<api-host>/billing/revenuecat`; set the **Authorization header** value to a long random string. Put the same string in the API service variable `REVENUECAT_WEBHOOK_AUTH` (Railway). Without it the webhook answers 503 and rooms never unlock.
4. [ ] API service variable `BILLING_ADMIN_SECRET` (long random string) enables the comp script for race directors: `CREWCUE_API_URL=https://<api-host> BILLING_ADMIN_SECRET=… npm run billing:comp -- <roomId> [--unlimited]`. It is never in the apps.
5. [ ] Staging only, optional: `BILLING_MANUAL_ENTITLEMENT=enabled` keeps `POST /race-rooms/:roomId/entitlement` (used by `scripts/staging-smoke-stoppage.sh`) and the debug fake purchase route working. Leave it unset in production: there, both answer 403. Both also answer 403 when `NODE_ENV` is unset; only `development` and `test` allow them without the flag.
6. [ ] Free codes: iOS uses App Store Connect **offer codes** (the app shows Apple's redeem sheet); Android uses Play **promo codes** (the app opens the Play redeem page). Beta testers buy in the TestFlight sandbox or as Play license testers at no charge.

## Failure modes

- **Preflight fails:** a secret or build variable is missing, or `CREWCUE_API_BASE_URL` is not https. The error lists which ones.
- **iOS "No profiles for 'com.crewcue.ios'":** the bundle id is not registered, or the API key lacks the App Manager role.
- **Android "Package not found":** the Play app does not exist yet, the first manual upload hasn't happened, or the service account lacks access.
- **Re-running a release:** use "Run workflow" on `Release` with the existing tag. The build number moves forward automatically. If the GitHub release already exists, the workflow replaces the attached `.aab`.
