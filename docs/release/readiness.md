# Release readiness: iOS, Android, API

Audit date: 2026-10-16. Scope: App Store, Google Play and production API requirements for the native clients (`apps/ios`, `apps/android`), shared Swift core (`packages/client-core`) and the Fastify API (`services/api`).

Status key: **done** = meets the store or production bar today; **gap** = engineering work, tracked by an issue or fixed in this PR; **needs-user** = needs an account, a key, a legal decision or a console action only the owner can take.

## Needs you

Ordered by what unblocks the first TestFlight build and the first Play internal-testing build soonest. The pipeline already exists: `npm run release -- X.Y.Z` pushes a tag, and `.github/workflows/release.yml` archives, signs and uploads both apps. It stops at "Check release secrets" until items 1 and 3 are done.

1. **Apple Developer team and App Store Connect app record** for bundle id `com.crewcue.ios`. Add these GitHub secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` (App Store Connect API key with App Manager role). `apps/ios/ExportOptions.plist` already uses automatic signing with `__TEAM_ID__` replaced in CI.
2. **Choose the API and Auth0 tenant the first test builds talk to** (#561). Release builds today call `http://127.0.0.1:3000` (iOS) and `http://10.0.2.2:3000` (Android), so a TestFlight build cannot sign in or load data. Fastest unblock: point Release at the https staging API, which already matches the staging Auth0 tenant in the apps, and keep production for later. Then add `crewcue://auth` callback and logout URLs for the iOS and Android Auth0 applications.
3. **Google Play Console developer account and app record** for `com.crewcue.android`.
   - Enroll in Play App Signing and create an upload keystore.
   - Add these GitHub secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` (service account granted release access in the Play Console).
   - Upload the first AAB to internal testing by hand in the Console. The Play API cannot create an app's first release.
4. **Play target API extension, only if #571 is not merged first.** Play accepts new apps only at API 36 since 2026-08-31. You can request an extension to 2026-11-01 in the Play Console.
5. **Privacy policy URL.** Both stores need it: App Store Connect before external TestFlight, and Play before any track goes out (Data safety form). In-app links are tracked in #569.
6. **App privacy answers (App Store) and Data safety form (Play).** Use [Privacy inputs](#privacy-inputs) below. Confirm the export-compliance answer: the app uses only HTTPS/TLS from the OS, and `ITSAppUsesNonExemptEncryption = NO` is already set for Release.
7. **Account deletion web page or email flow.** Play requires a deletion URL outside the app, and the in-app flow is #560. Provide a URL, even a form, before closed or production testing.
8. **Railway production service** (when you leave staging).
   - Set `NODE_ENV=production`, `AUTH0_ISSUER`, `AUTH0_AUDIENCE`, `PERSISTENCE_MODE=postgres` and `DATABASE_URL`.
   - New in this PR: with `NODE_ENV=production`, the API refuses to start without Auth0 unless a private `JWT_SECRET` is set. This stops it from accepting tokens signed with the public dev secret.
9. **Push credentials** (#563).
   - Turn on the Push capability on the App ID, then create an APNs auth key (.p8).
   - Create a Firebase project and add `google-services.json` for `com.crewcue.android`.
10. **Production third-party keys:** MapTiler (the map falls back to the MapLibre demo style without one), Stream Chat production app, and Strava API app (rate-limit tier and athlete-count approval).
11. **Store listings:** name, subtitle, description, keywords, category (Health & Fitness or Sports), screenshots (6.9" iPhone; Play phone), feature graphic, support URL, age rating questionnaire (App Store) and content rating questionnaire (Play), and the target audience form (Play).
12. **Background location justification** once #562 lands: an App Review note and a Play location-permission and foreground-service declaration, with a short video showing runner tracking.

## Fixed in this PR

| Fix | Evidence |
| --- | --- |
| Android release builds no longer accept a session from a link or intent extras. Before, any web page could open `crewcue://…?devSession=1&token=…&roomId=…` and the app saved that session. | `apps/android/.../session/DevSession.kt` (`enabled = BuildConfig.DEBUG`) |
| Android release builds open no `crewcue://dev/*` fixture route from outside the app. Internal fixture loads (sign-in, join copy) are unchanged. | `apps/android/.../nav/DevRoutes.kt` `inboundFeatureId`, `ui/ShellViewModel.kt` `open()` |
| Android release builds stop logging every screen URL to logcat. Dev links could carry a token. | `apps/android/.../di/AppContainer.kt` |
| Android release build turns on R8 (minify plus resource shrinking), with keep rules for the JNI facade and the reflection-loaded MapLibre and Stream bootstraps. | `apps/android/app/build.gradle.kts`, `apps/android/app/proguard-rules.pro` |
| Android ships only the ABIs that client-core is built for (`arm64-v8a`, `x86_64`). Before, MapLibre's 32-bit libs made Play offer the app to armeabi-v7a and x86 devices, where loading the Swift core crashes at startup. This also cuts the universal release APK (265 MB before). | `apps/android/app/build.gradle.kts` `ndk.abiFilters` |
| iOS Release builds ignore `crewcue://dev/*` links, `?state=` fixture overlays, and the `--deeplink` and `--dev-session` launch arguments. The Strava OAuth return still works. | `apps/ios/CrewCue/App/DevLinks.swift`, `App/ShellModel.swift` `open(_:)`, `App/LaunchConfiguration.swift` `resolve` |
| iOS privacy manifest, with collected data types and required-reason APIs: UserDefaults `CA92.1` (`PushRegistrationModel.swift`) and file timestamp `C617.1` (`PaceModel.swift` schedule cache inside the app container). | `apps/ios/CrewCue/PrivacyInfo.xcprivacy` (picked up by the synchronized `CrewCue` group) |
| iOS Dynamic Type: the 32pt invite-code field scales with `@ScaledMetric`. The fixed-size pill tab bar supports the Large Content Viewer, which is Apple's pattern for bars that cannot grow. | `Screens/Join/JoinCrewView.swift`, `Screens/Shell/ProductShellView.swift` |
| Android TalkBack: shared chat photos read "Shared photo" instead of "Image, image". | `ui/chat/ChatScreen.kt` |
| API refuses to start in production when it would verify tokens with the public `dev-only-secret`. | `services/api/src/lib/authEnv.ts` (+ test), `server.ts` |
| API logs drop query strings (Strava OAuth `code`/`state`, geocode search text) from request logs and `audit_log`, and redact auth, cookie and webhook-secret headers. | `services/api/src/lib/logSafeUrl.ts` (+ test), `app.ts`, `plugins/audit.ts` |

## iOS (App Store)

| Item | Status | Evidence | Fix |
| --- | --- | --- | --- |
| Privacy manifest | done (this PR) | `apps/ios/CrewCue/PrivacyInfo.xcprivacy`. SDK manifests ship with Auth0, StreamChat and MapLibre. | Before submitting, check that the transitive SPM packages (SimpleKeychain, JWTDecode, swift-markdown-ui, NetworkImage, Splash) are not on Apple's [list of SDKs that need a privacy manifest](https://developer.apple.com/support/third-party-SDK-requirements/). Xcode's "Generate Privacy Report" on the archive confirms it. |
| Location usage strings | done for foreground use | `Info.plist` `NSLocationWhenInUseUsageDescription`. `MapModel.swift` `WhenInUseLocator` requests When In Use only. | Add the Always string and the `location` background mode together with the background heartbeat (#562). Adding them before the code uses them would draw a rejection. |
| Notifications | gap | `RemoteNotifications.swift` calls `registerForRemoteNotifications()`. There is no `.entitlements` file and no `aps-environment`. | #563 (entitlement plus App ID capability: needs-user) |
| Export compliance | done | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` (Release, `project.pbxproj`) | Confirm in App Store Connect (needs-user) |
| URL schemes | done | `crewcue` (Auth0 `crewcue://auth`, Strava return). `com.crewcue.ios` is declared but looks unused (`Auth0SignIn.swift:46`). | Drop `com.crewcue.ios` when #561 reworks Info.plist |
| Account deletion (5.1.1(v)) | gap, **release blocker** | `Screens/Settings/SettingsSheet.swift` has only Sign out | #560 |
| App icon | done | `Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (single 1024 universal) | none |
| Launch screen | done | `Info.plist` `UILaunchScreen.UIColorName = LaunchBackground` | none |
| Version and build numbers | done | `MARKETING_VERSION 0.0.0` / `CURRENT_PROJECT_VERSION 1` in the project. `release.yml` sets version from the tag and build to `GITHUB_RUN_NUMBER + 100`. | none |
| Release build config | done | Release: `SWIFT_COMPILATION_MODE = wholemodule`, `dwarf-with-dsym`, `VALIDATE_PRODUCT`. `DEBUG` condition only in Debug. dSYMs are archived by CI. | none |
| Dev routes in Release | done (this PR) | `DevLinks.enabled` is false outside `DEBUG` | none |
| Environment config | gap, **TestFlight blocker** | `Info.plist`: `CrewCueAPIBaseURL = http://127.0.0.1:3000`, dev Auth0 tenant, staging audience. `LaunchConfiguration.swift` falls back to localhost. | #561 |
| Token storage | gap | `packages/client-core/.../Session.swift` writes `session.json` (plain JSON, no file protection) | #567 |
| Crash reporting | gap | none present | #564 |
| Accessibility | mostly done | `CrewFont` uses text styles. Labels on icon buttons (`CrewComponents.swift`, `ChatView.swift`). Race switcher has `.isSelected`. | Map and Pace screens not audited, since parallel sessions own them: #570 |
| Privacy policy and support links in app | gap | none in Settings or Profile | #569 |

## Android (Google Play)

| Item | Status | Evidence | Fix |
| --- | --- | --- | --- |
| Permissions | done for foreground use | `AndroidManifest.xml`: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`. There is no background location and no foreground service, so Play needs no background-location declaration today. | Background tracking: #562 adds a `location`-type foreground service (`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION`) and the Play declaration |
| Target API level | gap, **internal-testing blocker** | `compileSdk`/`targetSdk` 35, `minSdk` 28 (`app/build.gradle.kts`). Since 2026-08-31 Play accepts new apps and updates only at API 36 ([Play policy](https://support.google.com/googleplay/android-developer/answer/11926878)). An extension to 2026-11-01 can be requested in the Console. | #571 (needs AGP > 8.7.3; overlaps Dependabot #551). If #571 is not merged before the first upload, request the extension (needs-user). |
| Release minify / R8 | done (this PR) | `isMinifyEnabled = true`, `isShrinkResources = true`, `proguard-rules.pro` | Upload `mapping.txt` with the AAB once crash reporting lands (#564) |
| Signing | needs-user | Release `signingConfig` is created only when `CREWCUE_ANDROID_KEYSTORE` is set (`build.gradle.kts`). `release.yml` decodes the keystore from secrets. | Needs-you item 3 |
| Version numbers | done | `-Pcrewcue.versionCode/versionName` from `release.yml`. The default `1` / `0.0.0-dev` applies to local builds only. | none |
| Dev routes and dev session in release | done (this PR) | `DevSession.parse` and `DevRoutes.inboundFeatureId` gated on `BuildConfig.DEBUG` | none |
| Environment config | gap, **internal-testing blocker** | `res/values/strings.xml` uses the dev Auth0 tenant and an empty API URL, so `AuthConfig.kt` falls back to `http://10.0.2.2:3000` | #561 |
| Cleartext | done | No `usesCleartextTraffic` and no network security config, so cleartext is blocked at targetSdk 35 for platform stacks. The Swift networking layer was not verified to honour it. #561 removes the http fallback. | #561 |
| Backup | done | `android:allowBackup="false"` | none |
| Account deletion | gap, **release blocker** | `ui/settings/SettingsSheet.kt` has only Sign out | #560 (in-app) and needs-you item 7 (web URL) |
| Push (FCM) | gap | Firebase is not a dependency. `ui/chat/PushRegistrationScreen.kt` uses reflection, so the token is always null. | #563 |
| App icon | done | adaptive plus monochrome `mipmap-anydpi-v26/ic_launcher*.xml` | Play listing needs a 512px icon (needs-user, store listing) |
| Splash | done | `values-v31/themes.xml` (system splash) plus Compose `LaunchSplash` | none |
| Token storage | gap | `session/SessionStore.kt` (plain SharedPreferences) | #567 |
| Crash reporting | gap | none present | #564 |
| Accessibility | mostly done | Icons with `contentDescription = null` are inside labelled parents (`ShellScreen.kt`, `CrewComponents.kt`, `ChatScreen.kt`). The race switcher row is `selectable` (announces selected). | Map and Pace: #570 |

## API (production)

| Item | Status | Evidence | Fix |
| --- | --- | --- | --- |
| Auth on routes | done, with caveats | A global `preHandler` sets `request.identity` (`plugins/auth.ts`). Handlers return 401 or use `requireRoomMember` / `requireCourseEditor`. Unauthenticated routes are deliberate: `/health/*`, join-preview (rate limited), Strava OAuth redirect, push webhook (shared secret, timing-safe). | Default-deny is not enforced: a new route is open unless its handler checks. Worth a route-level `config.public` flag and a test that walks every route. |
| Dev JWT fallback | done (this PR) | `lib/authEnv.ts` blocks the public secret when `NODE_ENV=production` | none |
| Rate limits, body size, headers | gap | Only join-preview is limited (`routes/raceRooms.ts`). 32 MB global body limit (`app.ts`). No helmet or CORS policy. | #565 |
| Health checks | gap | `/health/ready` is static (`routes/health.ts`). Railway checks `/health/live`. | #566 |
| Migrations | gap | `services/api/scripts/apply-sql-migrations.mjs` re-runs every file per deploy (`railway.toml` `preDeployCommand`), with no ledger | #566 |
| Logging of PII | done (this PR), partial | Query strings stripped and auth headers redacted. User `sub` still appears in `ping_decision` and analytics logs. There are no lat/lng log calls. | Decide whether `sub` is acceptable in logs. Retention: #568 |
| Account deletion and data export | gap, **release blocker** | no `/me` route | #560 |
| Data retention | gap | Pings and activity history kept indefinitely (`room_ws2_runtime_json`) | #568 |
| Crash and error tracking | gap | OTel traces only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`src/telemetry.ts`). No process-level handlers. | #564 |
| Push delivery | gap | `lib/chatPushDispatch.ts` logs only | #563 |
| Secrets in repo | done | Only `.env*.example` tracked. Strava tokens are stored in plaintext at rest. | #567 |
| Persistence mode | gap | `PERSISTENCE_MODE` defaults to `memory` (`lib/roomPersistence.ts`) | #566 (guard, after confirming the staging env) |

## Offline and battery: location heartbeat

- **Today.** Neither client sends location in the background.
  - iOS: `WhenInUseLocator` uses `startUpdatingLocation`, 100 m accuracy and a 25 m distance filter. It stops when the app is backgrounded.
  - Android: one sample per screen appearance or "Send location" tap (`ui/map/DeviceLocation.kt`).
  - Battery cost is therefore low, but race-day tracking during a multi-hour ultra does not work.
- **Offline.** Pings queue in the shared Swift outbox (`OutboxStore`, atomic JSON in Application Support) and flush on the next send. Android does not retry automatically when connectivity returns. The invariants are tracked in #538 (another session); background tracking in #562.

## Privacy inputs

For the App Store privacy nutrition label and the Play Data safety form. The app does no tracking and has no ads.

| Data | Collected | Linked to user | Purpose | Notes |
| --- | --- | --- | --- | --- |
| Precise location | yes | yes | App functionality | Runner pings shown to that race's crew. Not used for ads or analytics. |
| Name (display name) | yes | yes | App functionality | Profile and crew list |
| Email address | yes | yes | App functionality, account | Through Auth0 sign-in |
| User ID | yes | yes | App functionality | Auth0 `sub` |
| Other user content | yes | yes | App functionality | Chat messages (Stream), crew notes, check-ins |
| Fitness | yes | yes | App functionality | Activity history and pacing from Strava or GPX import |
| Device ID | yes | yes | App functionality | Push token |
| Crash data | not yet | - | - | Add when #564 lands |

Processors: Auth0 (identity), Stream (chat), MapTiler (tiles, geocoding), Strava (only when the user connects it), Railway (hosting). Data is encrypted in transit (HTTPS) once #561 removes the http fallbacks. Users can request deletion once #560 and needs-you item 7 are done.

## Issues filed from this audit

- #560 In-app account deletion (API + iOS + Android) and web deletion link
- #561 Per-environment build config: production API and Auth0, no localhost fallback
- #562 Background location heartbeat for the runner
- #563 Push notifications end to end
- #564 Crash reporting and error tracking
- #565 API rate limiting, body limits, security headers
- #566 API readiness check and migration ledger
- #567 Secure token storage
- #568 Data retention
- #569 Privacy policy, terms and support links in Settings
- #570 Accessibility pass on Map and Pace screens
- #571 Android: target API 36 (Play requirement since 2026-08-31)
