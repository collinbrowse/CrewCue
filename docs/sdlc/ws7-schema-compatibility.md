# WS7 schema compatibility and versioning

**Status:** Adopted for Sprint 1 platform events (`PlatformEventEnvelope`).

**Related:** [ADR 0003: Canonical data and event log pattern](../adr/0003-canonical-data-and-event-log.md) · `packages/contracts` `PLATFORM_SCHEMA_VERSION`

## Version string

- `PLATFORM_SCHEMA_VERSION` is a **date-stamped batch** (`YYYY.MM.patch`) bumped when **breaking** or **material** contract changes ship together.
- HTTP ingress for `/platform/v1/events` currently requires **`z.literal(PLATFORM_SCHEMA_VERSION)`** so clients and servers cannot silently drift during the foundation phase.

## Compatibility rules (Sprint 1)

1. **Additive fields** on payloads are allowed **without** bumping the version only when all deployed readers ignore unknown keys (forward-compatible JSON).
2. **New `PlatformEventName` values** require a **documented** reducer/projection update before production rollout; the API enum list must be updated in the same change set.
3. **Breaking changes** (rename/remove payload fields, change semantics) require a **new `PLATFORM_SCHEMA_VERSION`**, a migration note in the sprint sign-off, and coordinated client releases.

## Idempotency

- `idempotencyKey` is **global** for Sprint 1 (single API process). Retried commands must reuse the same key; duplicates return HTTP **200** with `duplicate: true` and the original stored envelope.
- When PostgreSQL lands (ADR 0003), idempotency becomes a **unique constraint** on `(idempotency_key)` or `(tenant, idempotency_key)` depending on tenancy design.

## Replay ordering

- Events carry a monotonic **`sequence` per `(aggregateType, aggregateId)`** assigned by the writer. Reducers **must not** rely on wall-clock `occurredAt` alone.

## Roadmap

- Introduce **minor** acceptance of prior schema versions with explicit translation shims.
- Publish **JSON Schema** artifacts for selected payloads when external integrators consume the log.
