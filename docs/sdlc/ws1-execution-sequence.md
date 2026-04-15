# WS1 Execution Sequence (First Sprint)

This sequence is optimized for fastest path to a usable WS1 slice with minimal rework.

## Task 1: Race Room Domain and API Skeleton

### Objective

Establish core WS1 entities and API surface for room creation, retrieval, and activation.

### In-Scope

- define `RaceRoom`, membership, and role assignment contracts
- add API endpoints for:
  - create room
  - get room by id
  - activate race room
- enforce authenticated access baseline

### Acceptance Criteria Mapping

- invited users join within one flow and see correct role-based views (foundation for join flow contracts)
- race room remains accessible for full event duration (room lifecycle model includes active window)

### Out of Scope

- payment entitlement enforcement
- invite token redemption UX

## Task 2: Invite and Role Assignment Flow

### Objective

Implement invite acceptance and role-scoped membership assignment for race rooms.

### In-Scope

- create invite issue endpoint and accept invite endpoint
- assign role on invite acceptance
- return role-scoped room permissions payload
- reject invalid/expired invite tokens

### Acceptance Criteria Mapping

- invited users complete join in one flow and see correct role views
- unauthorized users cannot access race room data

### Out of Scope

- billing/payment gate
- team-level advanced role delegation

## Task 3: Entitlement Gate for Paid Race Room Access

### Objective

Gate room access behind per-race entitlement status.

### In-Scope

- model entitlement state on room access path
- enforce access checks on room entry endpoints
- add explicit error states for unpaid/expired entitlement
- log entitlement decision in audit trail

### Acceptance Criteria Mapping

- unauthorized users cannot access race room data
- entitlement checks correctly gate paid access in all room entry paths
- race room remains accessible for full event duration (when entitlement valid)

### Out of Scope

- subscription bundles
- external billing provider orchestration beyond stubbed integration contract

## Implementation Order Rationale

1. room primitives first
2. membership and role flow second
3. payment gate last

This order minimizes backtracking while preserving WS1 acceptance coverage.

## Done Definition for This Sprint

- all three tasks merged with green CI
- each PR maps to WS1 acceptance criteria explicitly
- manual smoke checks confirm role visibility and entitlement gating paths