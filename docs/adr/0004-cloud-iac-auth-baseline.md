# ADR 0004: Cloud, IaC, and auth baseline

- Status: Approved
- Date: 2026-04-15

## Context

WS0 requires a concrete infrastructure baseline and role-aware auth pattern for race room access.

## Decision

- Cloud provider: AWS
- IaC: Terraform
- Authentication and user management: Auth0
- Authorization model: role claims in JWT with room/team scoped permissions

## Rationale

- Managed cloud primitives accelerate baseline setup
- Terraform keeps environment parity and reviewable infra changes
- Auth0 shortens time-to-market for secure identity flows

## Consequences

- Vendor dependency requires migration strategy in Phase 2+
- Claims contract must be versioned and validated in APIs
