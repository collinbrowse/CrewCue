# WS4 Implementation Plan: Structured Incidents and Adaptive Plan Loop

## Objective

- Convert structured crew observations into explainable, actionable plan adjustments during race operations.

## User Roles Impacted

- crew member
- crew chief
- athlete
- team manager

## In-Scope Features

- structured incident capture for fuel, hydration, aid duration, issues, and protocol deviations
- deterministic plus AI recommendation engine for forward-section adjustments
- explicit before/after plan delta presentation to crew and athlete
- versioned plan updates with rationale and recovery history

## Out-of-Scope Features

- fully autonomous control loops without human approval
- unstructured freeform-only incident processing as primary path
- post-race coaching/reporting modules beyond operational updates

## Data Contracts

- entities: IncidentEvent, Recommendation, PlanVersion, PlanDelta, ExplainabilityRecord
- events: IncidentLogged, RecommendationGenerated, RecommendationAccepted, PlanVersionPublished
- APIs: incident submit, recommendation retrieve, plan diff and version history endpoints

## State Transitions

- incident captured -> normalized/validated -> recommendation generated
- recommendation reviewed -> accepted/rejected -> plan version updated or dismissed
- accepted update -> new plan broadcast -> downstream WS2/WS3/WS6 state refresh
- rollback requested -> prior plan version restored with audit trace

## Failure Modes

- low-quality incident inputs producing weak recommendations
- opaque AI outputs reducing crew trust
- recommendation latency too high for race-pace operations
- version conflicts when concurrent updates are proposed

## Acceptance Tests

- every recommendation includes rationale and visible impact
- full plan version history is preserved and recoverable
- incident-to-recommendation pipeline performs under race-time constraints
- accepted updates propagate correctly to operational boards and tasks

## Dependencies

- WS2 current split/ETA state as context
- WS7 versioned plan and explainability contracts
- WS5 resilient delivery and sync confidence for in-race updates
- WS0 platform AI integration and governance baseline

## Rollout Plan

- internal alpha: synthetic incident simulation against known race scenarios
- pilot races: crew-assisted recommendation review with manual override
- broad release: adaptive plan loop enabled for all supported race rooms