# WS2 Implementation Plan: Live Split Intelligence Engine

## Objective
- Continuously recompute checkpoint splits and ETA projections from athlete pings and race context to drive race-day decision-making.

## User Roles Impacted
- athlete
- crew member
- crew chief
- team manager

## In-Scope Features
- ingest athlete location pings when service is available
- deterministic recomputation of checkpoint splits and gap vs plan on accepted ping
- model inputs from athlete history, weather, course geometry, and benchmark times
- publish updated split/ETA/delta views to athlete and crew clients

## Out-of-Scope Features
- autonomous pacing control beyond recommendation outputs
- advanced external watch/hardware integrations deferred to Phase 2+
- highly customized sport-specific models beyond core ultra race scenarios

## Data Contracts
- entities: Checkpoint, SplitProjection, EtaProjection, PlanDelta, AthleteBaseline
- events: PingAccepted, PingRejected, SplitRecomputed, ProjectionPublished
- APIs: ping ingest, projection read endpoints, plan delta feed

## State Transitions
- ping received -> validation -> accepted/rejected
- accepted ping -> split/ETA recomputation -> projection published
- projection published -> downstream consumers refresh tasks, incidents, and status cards
- stale feed detected -> confidence degraded flag set for operators

## Failure Modes
- stale/invalid/outlier pings corrupting projections
- weather/feed latency producing inaccurate ETAs
- projection service lag under burst ping volume
- inconsistent projection state across offline/online clients

## Acceptance Tests
- deterministic recomputation on every valid ping
- invalid/stale pings handled safely without destabilizing state
- projection update latency remains within race-usable threshold
- projection outputs remain consumable by WS3, WS4, and WS6 interfaces

## Dependencies
- WS7 shared data contracts and canonical race entities
- WS5 transport reliability and sync confidence signals
- WS0 platform data processing and observability baseline

## Rollout Plan
- internal alpha: replay historical race traces for model verification
- pilot races: limited live ingestion with operator shadow validation
- broad release: full live projection service for active race rooms
