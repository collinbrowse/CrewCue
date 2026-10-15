# CrewCue

Race-day operations for ultra athletes and their crews: course and pacing plans, live athlete position and projections, aid-station check-ins, and crew chat.

## Layout

| Path | What it is |
| --- | --- |
| `apps/ios` | SwiftUI app |
| `apps/android` | Jetpack Compose app |
| `packages/client-core` | Swift package shared by both apps (no UI). Android calls it over JNI. |
| `clients/behavior` | Per-feature behavior checklists. The parity contract between iOS and Android. |
| `services/api` | Fastify + TypeScript API. Domain rules, auth, persistence, pacing, GPX. |
| `packages/contracts` | Wire types shared by the API and generated into Swift/Kotlin |
| `packages/map-core` | Server-side course geometry and GPX parsing |
| `fixtures/pacing` | Shared pacing fixtures and backtest inputs |
| `docs` | ADRs, API notes, runbooks, process docs (see `docs/sdlc/README.md`) |

## Local setup

```bash
npm install
docker compose -f docker-compose.local.yml up -d   # Postgres + OTel collector
npm run env:init      # once: seed local/staging env profiles
npm run env:local     # or env:staging; env:status shows the active profile
npm run dev:api       # or dev:api:memory for no Postgres
```

Native apps:

```bash
npm run verify:ios        # build the iOS app for the simulator
npm run verify:android    # assemble the Android debug APK (needs ANDROID_HOME)
npm run agent:ios:ready -- --deeplink crewcue://dev/app-shell       # build, install, open on a simulator
npm run agent:android:ready -- --deeplink crewcue://dev/app-shell   # same on an emulator
npm run test:ios          # XCUITest: every feature deeplink renders its checklist label
npm run test:android      # Compose instrumented test, same check (needs a running emulator)
```

`crewcue://dev/<id>` deeplinks open fixture screens without Auth0. The ids are listed in `clients/behavior/deeplinks.json`.

## Quality gate

```bash
npm run verify   # lint, typecheck, tests, builds, harness tests, client-core checks
```

CI runs `verify` plus Postgres integration tests, and on PRs that touch them, the iOS and Android UI smoke tests.

Scoped variants: `verify:api`, `verify:contracts`, `verify:client-core`, `verify:ios`, `verify:android`.

## Deploy and release

- **API:** Railway deploys `main` (`railway.toml` runs migrations, then health-checks `/health/live`). See `docs/runbooks/staging-deploy.md`.
- **Mobile:** `npm run release -- X.Y.Z` tags `main`. The `Release` workflow uploads iOS to TestFlight and Android to Play internal testing. Secrets and first-time setup: `docs/runbooks/mobile-release.md`.

## Contributing

PR bodies must use `.github/pull_request_template.md`. CI rejects PRs missing its decision sections. Agents start at `AGENTS.md`.
