# WS0 Security Baseline

## Identity and Access

- Authentication provider: Auth0
- API verifies JWT on protected routes
- Claims contract includes team and room-scoped roles
- Unauthorized requests are rejected before business handlers run

## Secrets Handling

- No plaintext production secrets in repository
- Environment-specific secrets injected via CI/CD and cloud secret manager
- Local development uses `.env.example` files only

## Auditability

- API writes audit logs for every request with actor/request metadata
- Security-sensitive actions must include immutable event records

## Dependency and Supply Chain

- CI runs dependency install with lockfile and automated audit checks
- Pull request checks required before merges
