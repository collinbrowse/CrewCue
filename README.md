# CrewCue

Native iOS and Android clients plus the API. The Expo app is removed. Do not add `apps/mobile`. Native race-day screens are in progress on `feature/native-client-split` until `clients/behavior/deeplinks.json` records a device-proven pass.

## Workspace Layout

- `apps/ios` - SwiftUI client
- `apps/android` - Jetpack Compose client
- `packages/client-core` - shared Swift client behavior (no UI)
- `services/api` - Fastify TypeScript API with auth and audit hooks
- `packages/contracts` - Shared domain/event/auth contracts
- `infra/terraform` - AWS staging infrastructure baseline
- `docs/adr` - Approved WS0 architecture decisions
- `docs/api` - HTTP contract notes for in-flight slices (e.g. `docs/api/ws1-race-rooms.md`)
- `observability` - OpenTelemetry collector baseline

## Local Setup

```bash
npm install
docker compose -f docker-compose.local.yml up -d
npm run env:init          # once: seed local/staging profiles from current .env
npm run env:local         # or: npm run env:staging  (Railway)
npm run env:status
npm run dev:api           # or: npm run dev:api:memory
npm run verify:ios        # SwiftUI simulator build
npm run verify:android    # Compose debug APK, when ANDROID_HOME is set
```

Switch API backends with `npm run env:local` / `npm run env:staging`, then restart the API. Auth0 notes: `docs/runbooks/auth0-and-social-idp-setup.md`. Guest UI proof uses `crewcue://dev/<id>` and does not sign in.

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run build
npm run test
```
