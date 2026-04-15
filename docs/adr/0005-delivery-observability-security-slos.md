# ADR 0005: Delivery, observability, security, and SLOs

- Status: Approved
- Date: 2026-04-15

## Context

WS0 must define quality gates, telemetry baseline, and minimum reliability/security targets before downstream workstreams start.

## Decision

- CI/CD: GitHub Actions with required status checks
- Observability: OpenTelemetry + OTLP exporter (vendor-agnostic)
- Security baseline: secret scanning, dependency audit, signed JWT verification, audit logging
- Initial SLOs:
  - API availability: 99.9%
  - P95 API latency: < 350ms for core reads/writes
  - Event processing delay: < 5s P95
  - Error budget burn alerting for availability and latency breaches

## Rationale

- Keeps tooling lightweight while retaining portability
- Defines objective readiness gates for WS1-WS7

## Consequences

- Team must maintain telemetry coverage as new services ship
- SLO targets will need periodic revision with production load data
