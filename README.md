# CrewCue WS0 Foundation

This repository now contains the WS0 implementation baseline for a hybrid iOS/Android mobile app and supporting backend platform.

## Workspace Layout

- `apps/mobile` - React Native (Expo) hybrid app
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
npm run env:status        # confirm mobile API URL + Auth0 audience match API
npm run dev:api           # or: npm run dev:api:memory
npm run dev:mobile
```

Switch backends anytime with `npm run env:local` / `npm run env:staging`, then restart Metro and the API. Auth0 sync notes: `docs/runbooks/auth0-and-social-idp-setup.md`.

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run build
npm run test
```
