# WS0 SLO and Readiness Targets

## Initial SLOs

- API availability: 99.9%
- API latency: P95 < 350ms
- Event processing delay: P95 < 5 seconds
- Error budget policy: page on fast burn, ticket on slow burn

## WS0 Readiness Gate

WS0 is considered complete when:

1. ADR set is approved and linked in `docs/adr/README.md`
2. Mobile, API, and contracts packages build in CI
3. Staging deployment workflow runs successfully
4. Telemetry and audit logging are available
5. Security baseline controls are documented and enforced in code/config

## Verification Commands

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run test
```
