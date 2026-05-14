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
npm run dev:api
npm run dev:mobile
```

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run build
npm run test
```
