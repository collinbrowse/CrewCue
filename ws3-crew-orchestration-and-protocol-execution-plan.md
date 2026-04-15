# WS3 Implementation Plan: Crew Orchestration and Protocol Execution

## Objective
- Transform aid-station intent into executable, role-specific task operations with shared protocol visibility for all authorized crew.

## User Roles Impacted
- crew member
- crew chief
- athlete
- team manager

## In-Scope Features
- athlete-defined aid-station planning inputs
- task assignment by checkpoint and crew role
- shared protocol notes (heat, nutrition, blister, and related procedures)
- shared timeline showing task execution and notes

## Out-of-Scope Features
- generalized non-race project/task management
- advanced optimization/autoscheduling beyond rules-based MVP assignment
- long-term training workflow orchestration

## Data Contracts
- entities: CheckpointPlan, CrewTask, CrewAssignment, ProtocolNote, OpsTimelineEvent
- events: TaskCreated, TaskAssigned, TaskCompleted, ProtocolUpdated, TimelineNoteAdded
- APIs: task board read/update, assignment mutation, protocol content retrieval

## State Transitions
- checkpoint plan authored -> tasks generated -> tasks assigned
- task in progress -> task completed -> timeline updated for all participants
- protocol updated -> checkpoint context refreshed for next crew action window
- conflicting edits detected -> merge/review flow applied via shared contracts

## Failure Modes
- wrong-role task visibility causing missed execution
- concurrent updates creating conflicting task states
- protocol lookup friction at checkpoint handoff moments
- offline action backlog delaying shared state convergence

## Acceptance Tests
- each crew user sees relevant tasks plus shared notes
- completed tasks sync to all authorized participants
- protocol content is quickly accessible at each checkpoint
- timeline reflects ordered actions and remains consistent after sync recovery

## Dependencies
- WS1 access control and role authorization
- WS7 checkpoint/task/event schema contracts
- WS5 offline/sync behavior for shared task state
- WS0 platform baseline for real-time APIs and mobile/web clients

## Rollout Plan
- internal alpha: simulated checkpoint task runs with staff users
- pilot races: controlled deployment with select crew teams
- broad release: default crew execution experience for race rooms
