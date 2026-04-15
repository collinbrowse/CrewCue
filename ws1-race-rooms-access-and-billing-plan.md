# WS1 Implementation Plan: Race Rooms, Access, and Billing

## Objective
- Deliver paid, per-race rooms where athlete and crew collaborate in shared race state with secure role-based access.

## User Roles Impacted
- athlete
- crew member
- crew chief
- team manager

## In-Scope Features
- race room creation and race activation
- invite and join flow for crew participants
- role and permission assignment with scoped UI access
- per-race payment entitlement tied to room access

## Out-of-Scope Features
- subscription bundles across multiple races
- marketplace or social discovery features
- enterprise identity federation beyond MVP auth

## Data Contracts
- entities: Team, RaceRoom, Athlete, CrewMember, RoleAssignment, Entitlement
- events: RaceRoomCreated, InviteSent, InviteAccepted, RoleGranted, RaceActivated, PaymentConfirmed
- APIs: room create/read/update, invite accept, role assignment, entitlement check

## State Transitions
- room created -> invite issued -> invite accepted -> role granted
- entitlement pending -> payment confirmed -> room access enabled
- race scheduled -> race activated -> room operational during event window
- access revoked/expired -> room data hidden for unauthorized users

## Failure Modes
- unauthorized access due to role mismatch
- invite token expiration or duplicate redemption
- delayed payment confirmation causing access lockout
- permission propagation lag across clients

## Acceptance Tests
- unauthorized users cannot access race room data
- invited users complete join in one flow and see correct role views
- room remains available throughout full event duration
- entitlement checks correctly gate paid access in all room entry paths

## Dependencies
- WS7 entity model and event/audit contracts
- WS0 platform auth, billing integration primitives, and deployment baseline

## Rollout Plan
- internal alpha: single-room flow with manual billing verification
- pilot races: full invite + entitlement checks with live crew teams
- broad release: self-serve race room operations for all supported customers
