# WS6 Implementation Plan: Team Command Center and Multi-Athlete Concurrency

## Objective
- Enable team and brand managers to monitor and triage multiple active athletes from one operational board.

## User Roles Impacted
- team manager
- crew chief
- crew member
- athlete

## In-Scope Features
- team account with athlete roster and drill-down views
- status cards with configurable colored metrics (calories/hr, carbs/hr, electrolytes/hr, sodium/hr)
- manager-controlled metric selection per board or athlete
- overlap view for staffing conflicts
- checkpoint demand heatmap for concurrent athlete windows

## Out-of-Scope Features
- predictive workforce automation beyond visibility-first MVP
- non-race business analytics dashboards
- cross-organization benchmarking features

## Data Contracts
- entities: TeamBoard, AthleteStatusCard, MetricConfig, StaffingOverlap, CheckpointHeatmap
- events: StatusCardUpdated, MetricConfigChanged, OverlapDetected, HeatmapRecomputed
- APIs: board aggregate read, metric config mutation, overlap and heatmap retrieval

## State Transitions
- team selected -> roster loaded -> active athlete board rendered
- new live data received -> status cards recolored/re-ranked
- overlap detected -> conflict surfaced -> staffing reassignment captured
- demand spike window identified -> heatmap refreshed for planning actions

## Failure Modes
- stale upstream data leading to incorrect triage priority
- metric misconfiguration hiding key athlete risks
- overlap detection delays during dense race windows
- board performance degradation with high athlete concurrency

## Acceptance Tests
- managers triage multiple athletes from one board without context switching
- overlap conflicts appear before and during conflict windows
- status card colors and values update with latest accepted data
- board remains usable at target concurrency load during simulations

## Dependencies
- WS2 live projections and ETAs
- WS3 task and checkpoint execution state
- WS5 sync confidence/freshness indicators
- WS0 scalable platform architecture for aggregate queries and UI performance

## Rollout Plan
- internal alpha: synthetic multi-athlete simulation board
- pilot races: team manager field trials with limited rosters
- broad release: multi-athlete command center as standard team feature
