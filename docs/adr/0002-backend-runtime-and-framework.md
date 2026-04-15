# ADR 0002: Backend runtime and framework

- Status: Approved
- Date: 2026-04-15

## Context

WS1-WS7 require a typed API platform, event processing, and efficient local development.

## Decision

Use Node.js with TypeScript and Fastify for API services.

## Rationale

- Shared TypeScript types with contracts package
- Fastify provides high performance and plugin-based architecture
- Low operational complexity for a growing multi-service platform

## Consequences

- Runtime boundaries must be explicit for CPU-heavy tasks
- Requires strict linting and type checks to preserve correctness
