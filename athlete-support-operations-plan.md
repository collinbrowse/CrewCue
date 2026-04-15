# Athlete-Crew Race Operations Master Plan

## Product Boundary
- Build one product: a race-day operations command center for athlete + crew.
- Exclude generic training planning, social route discovery, and non-race lifestyle features.
- Success condition: athlete and crew can run race operations end-to-end without leaving the app.

## Workstream Map (for spin-off planning)
- **WS0:** Tech Stack Decision and Implementation
- **WS1:** Race Rooms, Access, and Billing
- **WS2:** Live Split Intelligence Engine
- **WS3:** Crew Orchestration and Protocol Execution
- **WS4:** Structured Incidents and Adaptive Plan Loop
- **WS5:** Connectivity Resilience and Sync Health
- **WS6:** Team Command Center and Multi-Athlete Concurrency
- **WS7:** Shared Platform Contracts and Data Model

## Phase Allocation
- **Phase 1 (MVP):** WS0, WS1, WS2, WS3, WS4 (v1), WS5, WS6 essentials, WS7 foundations
- **Phase 2+:** deeper AI adaptation, advanced staffing optimization, external race/watch integrations, multi-sport templates

## WS0 Status (Completed)
- **Current state:** completed and merged to `main`
- **Decisions locked:** hybrid iOS/Android mobile, TypeScript/Fastify API, PostgreSQL event-log pattern, AWS + Terraform, Auth0, GitHub Actions, OpenTelemetry, baseline SLOs/security controls
- **Foundation delivered:** mobile app scaffold, API scaffold, shared contracts package, staging infra baseline, CI/deploy/rollback workflows, security/readiness/runbook docs
- **Readiness outcome:** WS0 acceptance gate passed; WS1 implementation unblocked

## WS0: Tech Stack Decision and Implementation
**Goal**
- decide and implement the technology stack that supports all race operations workstreams end-to-end.

**MVP Scope**
- select frontend, backend, mobile, data, infrastructure, and AI integration stack components
- implement baseline project architecture, environments, deployment pipelines, and observability
- establish shared engineering standards for security, reliability, performance, and maintainability

**Inputs**
- product requirements across WS1-WS7, team capability constraints, budget/timeline constraints, compliance and security requirements

**Outputs**
- production-ready foundational stack and platform setup enabling all downstream workstreams to build and ship

**Dependencies**
- none (enabling foundation layer)

**Acceptance Criteria**
- stack decisions are documented with rationale and trade-offs
- core environments and CI/CD pipelines are operational for all primary services/apps
- platform baseline supports implementation velocity and reliability targets for WS1-WS7

## WS1: Race Rooms, Access, and Billing
**Goal**
- Paid per-race group room where athlete + crew collaborate in one shared state.

**MVP Scope**
- race room creation, invite flow, role/permission assignment, race activation
- per-race payment entitlement tied to room access

**Inputs**
- user identity, race metadata, role definitions, payment status

**Outputs**
- active race room with authorized participants and role-scoped UI access

**Dependencies**
- WS7 entity model and audit/event logging

**Acceptance Criteria**
- unauthorized users cannot view room data
- invited users join within one flow and see correct role-based views
- race room remains accessible for full event duration

## WS2: Live Split Intelligence Engine
**Goal**
- recompute splits/ETA continuously from athlete pings and race context.

**MVP Scope**
- ingest location when service exists
- recompute checkpoint splits and gap vs plan on each accepted ping
- model inputs include athlete history files, weather, course geometry, segment distance/vert/technicality, prior course benchmark times

**Inputs**
- location stream, athlete baseline files, weather feed, course/checkpoint definitions

**Outputs**
- updated split table, ETA projections, plan deltas visible to athlete and crew

**Dependencies**
- WS7 data contracts; WS5 transport reliability

**Acceptance Criteria**
- deterministic recomputation on valid ping
- stale/invalid pings handled safely
- plan update latency stays within race-usable threshold

## WS3: Crew Orchestration and Protocol Execution
**Goal**
- convert aid-station intent into executable task operations for crew members.

**MVP Scope**
- athlete-defined aid-station plans
- task assignment per crew member
- shared protocol notes (heat, nutrition, blister, etc.)
- shared timeline of actions and notes

**Inputs**
- checkpoint plan, task templates, user assignments, protocol content

**Outputs**
- role-specific task boards + completion state + shared ops timeline

**Dependencies**
- WS1 access control; WS7 checkpoint/task schema

**Acceptance Criteria**
- each crew member sees only relevant tasks plus shared notes
- completed tasks sync to all authorized participants
- protocol content accessible at each checkpoint with low friction

## WS4: Structured Incidents and Adaptive Plan Loop
**Goal**
- convert crew observations into actionable in-race plan adjustments.

**MVP Scope**
- structured incident capture (fuel, hydration, time-in-aid, issues, protocol deviations)
- deterministic + AI recommendation layer for forward-section adjustments
- explicit before/after plan deltas shown to crew + athlete

**Inputs**
- structured incident events, current plan state, athlete model context

**Outputs**
- updated nutrition/hydration/execution recommendations and revised checkpoint plan

**Dependencies**
- WS2 split state; WS7 versioned plans and explainability contract

**Acceptance Criteria**
- each recommendation includes rationale
- plan version history is preserved and recoverable
- incident-to-recommendation pipeline works during race pace operations

## WS5: Connectivity Resilience and Sync Health
**Goal**
- keep race operations functional across intermittent or no-service conditions.

**MVP Scope**
- local queue for unsent updates
- BLE peer sync for notes/task state
- conflict merge for concurrent edits
- explicit data freshness state
- per-crew sync health: last successful sync timestamp + pending update count per device

**Inputs**
- local operation queue, peer discovery/sync events, merge metadata

**Outputs**
- convergent shared state with operator-visible sync confidence

**Dependencies**
- WS7 event log and merge semantics

**Acceptance Criteria**
- no data loss through offline/online transitions
- crew can see who is stale and how far behind they are
- merged state remains consistent across devices

## WS6: Team Command Center and Multi-Athlete Concurrency
**Goal**
- support team/brand managers operating multiple athletes simultaneously.

**MVP Scope**
- team account with athlete roster and drill-down
- status cards with configurable colored metrics: calories/hr, carbs/hr, electrolytes/hr, sodium/hr
- manager-controlled metric selection (for example calories/hr vs carbs/hr tracking)
- overlap view for staffing conflicts
- concurrent checkpoint heatmap for simultaneous athlete demand

**Inputs**
- per-athlete live state, checkpoint ETAs, staffing assignments, metric config

**Outputs**
- cross-athlete operational board and conflict-aware staffing visibility

**Dependencies**
- WS2 live projections; WS3 tasks; WS5 sync confidence signals

**Acceptance Criteria**
- managers can triage athletes from one board
- overlap conflicts are visible before and during windows
- status card color states update with latest accepted data

## WS7: Shared Platform Contracts and Data Model
**Goal**
- provide stable contracts so each workstream can evolve independently.

**MVP Scope**
- entity model: Team -> RaceRoom -> Athlete -> CrewMember -> Checkpoint -> Task -> Event -> PlanVersion
- event-log-first architecture; current state reduced from events
- versioned plan storage with diffs
- transport abstraction: cloud primary, BLE secondary
- API/event schemas for all workstreams

**Inputs**
- events from WS1-WS6

**Outputs**
- canonical state and interfaces consumed by all workstreams

**Dependencies**
- none (foundation layer)

**Acceptance Criteria**
- schema stability documented
- idempotent event processing
- reproducible state reconstruction from event log

## Spin-Off Plan Template (for any workstream)
Use this template to expand any WS into a dedicated implementation plan:
- **Objective:** what outcome this workstream must deliver
- **User roles impacted:** athlete, crew member, crew chief, team manager
- **In-scope features:** exact MVP behaviors to build
- **Out-of-scope features:** explicitly deferred
- **Data contracts:** entities, events, and API endpoints touched
- **State transitions:** create/update/resolve/fallback flows
- **Failure modes:** offline, stale data, duplicate events, conflict cases
- **Acceptance tests:** functional, reliability, latency, and usability checks
- **Dependencies:** upstream contracts and downstream consumers
- **Rollout plan:** internal alpha -> pilot races -> broad release

## Master Timeline (12-16 weeks)
- **Weeks 1-3:** WS7 foundation + WS1 race rooms/access/billing
- **Weeks 4-6:** WS2 live split engine baseline
- **Weeks 7-9:** WS3 crew orchestration + WS5 connectivity resilience
- **Weeks 10-12:** WS4 incident capture and adaptive plan loop v1
- **Weeks 13-16:** WS6 team command center and multi-athlete concurrency hardening

## Master Validation Metrics
- aid-station dwell time reduction vs baseline workflow
- task completion rate per checkpoint and per role
- incident-to-plan-update latency
- percentage of race-critical updates delivered under low connectivity
- sync health transparency usage (how often crews act on stale/pending indicators)
- single-app sufficiency score from athlete + crew + manager
