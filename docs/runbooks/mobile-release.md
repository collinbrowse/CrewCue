# Mobile release runbook

`npm run release -- X.Y.Z` tags `main`. The `Release` workflow then:

1. Checks that every secret and build variable below exists in the `release` environment, and that the API URL is https.
2. Archives the iOS app and uploads it to TestFlight. Signing is cloud-managed through the App Store Connect API key, so there are no certificates or profiles to rotate by hand.
3. Builds a signed Android App Bundle and uploads it to the Google Play **internal** track.
4. Publishes a GitHub release with generated notes and the `.aab` attached.

Version: `X.Y.Z` becomes the iOS marketing version and the Android `versionName`. The build number (iOS) and `versionCode` (Android) are `run_number + 100`, which only ever increases.

`npm run release` refuses to tag unless you are on a clean `main` in sync with `origin`, the version is higher than the last tag, and CI on that commit is green. `--dry-run` checks without pushing.

## One-time setup

### GitHub

Create an environment named `release` (Settings → Environments). Optionally add required reviewers so a tag waits for approval. Add these environment secrets:

| Secret | How to get it |
| --- | --- |
| `APPLE_TEAM_ID` | developer.apple.com → Membership → Team ID |
| `ASC_KEY_ID` | App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key with the **App Manager** role |
| `ASC_ISSUER_ID` | Same page, "Issuer ID" |
| `ASC_KEY_P8_BASE64` | `base64 -i AuthKey_XXXX.p8 \| pbcopy` (the key downloads only once) |
| `ANDROID_KEYSTORE_BASE64` | Create an upload key: `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`, then `base64 -i upload.jks \| pbcopy`. Back the `.jks` up outside the repo. |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password from `keytool` |
| `ANDROID_KEY_ALIAS` | `upload` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | Key password from `keytool` |
| `PLAY_SERVICE_ACCOUNT_JSON` | Google Cloud → create a service account and JSON key. Play Console → Users and permissions → invite the service-account email with release permissions for the app. Paste the JSON contents. |

Add these environment **variables** (not secrets). They pick the server and Auth0 tenant that release builds talk to. Release builds have no localhost fallback: the workflow stops if one is missing, a local Release build without them shows "CrewCue can't start", and a local `bundleRelease` or `assembleRelease` fails at configuration time.

| Variable | Value |
| --- | --- |
| `CREWCUE_API_BASE_URL` | The https API, for example the Railway staging service URL for the first test builds (`https://<staging-host>`). Then the production host. |
| `CREWCUE_AUTH0_DOMAIN` | The Auth0 tenant domain. Staging: `dev-ozh1r6603ymvszq6.us.auth0.com` |
| `CREWCUE_AUTH0_CLIENT_ID` | The Auth0 native application's client id. Staging: `oRRfHuZS7jN2pd8wn9aAwRnyay0kuzia` |
| `CREWCUE_AUTH0_AUDIENCE` | The API audience. Staging: `https://api.crewcue.staging` |

In that Auth0 application, allow these callback and logout URLs: `crewcue://auth` (iOS, `Auth0SignIn.swift`) and `crewcue://<auth0-domain>/android/com.crewcue.android/callback` (Android, the Auth0 SDK default for the `crewcue` scheme).

To build Release locally, pass the same values: iOS as build settings (`xcodebuild … CREWCUE_API_BASE_URL=https://… CREWCUE_AUTH0_DOMAIN=…`); Android as Gradle properties (`-Pcrewcue.release.apiBaseUrl=https://… -Pcrewcue.release.auth0Domain=… -Pcrewcue.release.auth0ClientId=… -Pcrewcue.release.auth0Audience=…`). Debug builds keep using the local API and the dev tenant (`apps/ios/Config/CrewCue.xcconfig`, `apps/android/app/src/main/res/values/strings.xml`).

Optional variable `PLAY_RELEASE_STATUS`: set it to `draft` until the Play app has finished its first review. Play rejects `completed` releases on apps still in draft.

### Apple

1. Enroll in the Apple Developer Program.
2. Register the bundle id `com.crewcue.ios` (Identifiers) with Sign in with Apple enabled.
3. In App Store Connect, create the app with that bundle id. TestFlight internal testers see builds after processing (about 10–30 minutes).

### Google Play

1. Create the app in Play Console with package `com.crewcue.android`. Enroll in Play App Signing (default) and register the upload key above.
2. Play requires the **first** bundle to be uploaded by hand. Build it locally with the same env vars as the workflow, or take `app-release.aab` from a failed workflow run's artifacts, and upload it to Internal testing once. After that the workflow can upload.

## Failure modes

- **Preflight fails:** a secret or build variable is missing, or `CREWCUE_API_BASE_URL` is not https. The error lists which ones.
- **iOS "No profiles for 'com.crewcue.ios'":** the bundle id is not registered, or the API key lacks the App Manager role.
- **Android "Package not found":** the Play app does not exist yet, the first manual upload hasn't happened, or the service account lacks access.
- **Re-running a release:** use "Run workflow" on `Release` with the existing tag. The build number moves forward automatically. If the GitHub release already exists, the workflow replaces the attached `.aab`.
