# ADR 0003: Canonical data and event log pattern

- Status: Approved
- Date: 2026-04-15

## Context

WS7 requires event-log-first architecture with deterministic state reconstruction and idempotent processing.

## Decision

Use PostgreSQL as the primary datastore with:

- append-only `domain_events` table as source of truth
- projection tables for query-optimized current state
- idempotency keys for command/event handling

## Rationale

- Single operational datastore with strong consistency guarantees
- Supports both transactional writes and event replay workflows
- Easier operations during early-stage product buildout

## Consequences

- Event schema versioning discipline is mandatory
- Projection rebuild tooling is required for migration/recovery
