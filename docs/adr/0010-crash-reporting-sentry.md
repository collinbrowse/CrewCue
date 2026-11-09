# ADR 0010: Crash reporting and error tracking with Sentry (Developer plan)

- Status: Approved
- Date: 2026-11-09
- Issue: #564

## Context

The first TestFlight and Play closed-test builds go to outside testers soon, and agents do most of the development. Nothing reported crashes: no client SDK, and the API had no error tracking or process-level handlers. The owner decided on 2026-11-09 to use only free tiers for v1.

Options considered:

- **MetricKit + Play vitals (no SDK).** Free and private. But MetricKit delivers diagnostics a day late and only from opted-in devices, Play vitals is aggregate, and neither covers the API. Agents cannot query either one.
- **Firebase Crashlytics.** Free, but mobile only, and it pulls Google Play services and Firebase config into both apps for crash reporting alone.
- **Sentry Developer plan.** Free (1 user, 5k errors a month), one SDK family for iOS, Android and Node, symbol upload through `sentry-cli` / the Gradle plugin, and an API that agents can query.

## Decision

Use Sentry on the free Developer plan, with one Sentry project per surface (API, iOS, Android).

- **Errors only.** No performance tracing, profiling, session replay or user identification, to stay inside the free quota and keep the privacy answers simple.
- **Off unless a DSN is set.** API: `SENTRY_DSN` env (Railway). iOS and Android: the DSN reaches only release builds, from `release.yml` variables. Debug, local and CI builds never initialise the SDK.
- **No PII.** The SDK's `dataCollection` collects no user info, cookies, bodies or query params, and every event is scrubbed before send: no query strings, auth or cookie headers, request bodies, tokens, emails or precise lat/lng, and no `user`. Same rules as the request logger (`services/api/src/lib/logSafeUrl.ts`).
- **Symbols.** `release.yml` uploads iOS dSYMs and the Android R8 `mapping.txt` when `SENTRY_AUTH_TOKEN` is present, and skips with a warning otherwise.

## Consequences

- Crashes from testers and server faults land in one place that agents can read.
- 5k errors a month is the ceiling. A crash loop can burn it; Sentry drops events past quota rather than billing.
- App privacy answers gain Crash Data and Performance Data (not linked to the user), and the Play Data safety form gains Crash logs and Diagnostics.
- Moving off the free plan, or adding tracing, is a new decision.
