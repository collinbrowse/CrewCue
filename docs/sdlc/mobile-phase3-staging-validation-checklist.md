# Mobile Phase 3 staging validation checklist (WS3 + WS4)

**Audience:** operators and engineers validating mobile MVP progress on staging.  
**Scope:** validates the Phase 3 depth loop shipped in mobile: task execution + incident/recommendation flow + timeline/protocol visibility.

**Related docs:**  
- [ui-delivery-roadmap-and-spec.md](./ui-delivery-roadmap-and-spec.md)  
- [chunk-c-smoke-script.md](./chunk-c-smoke-script.md)

---

## 1) Exit gate covered by this checklist

This checklist validates the Phase 3 exit gate in `ui-delivery-roadmap-and-spec.md`:

> Incident-to-plan-update workflow complete in app.

It assumes you already completed the Chunk C baseline smoke (`sign-in -> room -> paid -> active -> ping -> projection`).

---

## 2) Preconditions

1. Staging API healthy (`/health/live` OK).
2. Auth0 login works in mobile.
3. You are authenticated as a user with a crew-capable role in the test room (`crew_member`, `crew_chief`, or `team_manager`).
4. Room is `active` and entitlement is `paid`.

---

## 3) Validation steps (single session)

Run all steps from one app session in order.

### Step A — fetch task board baseline

- Tap `Fetch task board (GET)`.
- Pass:
  - task panel renders (even if empty),
  - no API error shown in status rail.

### Step B — task execution controls

- In the task panel, for any `pending` task:
  - tap `Assign to me`,
  - tap `Start task`.
- For any `in_progress` task:
  - tap `Complete task`.
- Pass:
  - each action enqueues to outbox (`Outbox queue inspector` shows task operations),
  - `Process Outbox` or auto-process sends operations,
  - operation status transitions to `sent` (or explicit conflict/rejected with guidance).

### Step C — post incident

- Tap `Post incident (WS4)`.
- Tap `Fetch incidents (GET)`.
- Pass:
  - incident list count increases,
  - latest incident row shows category/severity/summary.

### Step D — generate recommendation

- Tap `Generate recommendation`.
- Pass:
  - recommendation panel appears,
  - status is `pending`,
  - rationale + proposed summary render,
  - explainability factors render when provided.

### Step E — decision and plan delta

- Tap `Accept recommendation` (or `Reject recommendation` for alternate path).
- If accepted:
  - pass when recommendation status becomes `accepted`,
  - `Latest plan delta` renders with from/to version and changes.
- If rejected:
  - pass when recommendation status becomes `rejected`,
  - no crash and clear status feedback.

### Step F — protocol + timeline operational view

- Tap `Post protocol note (staging)`.
- Tap `Fetch ops timeline (GET)`.
- Pass:
  - `Protocol notes` panel shows latest note details,
  - `Ops timeline` panel shows recent events with event kind + actor + message,
  - empty states (if no data) are explicit and actionable.

---

## 4) Failure hints

- `Insufficient permissions` on recommendation decision:
  - verify room membership role for current user supports decision endpoints.
- Recommendation generation blocked:
  - ensure at least one incident exists in room.
- Outbox operations remain pending:
  - keep app foregrounded, verify connectivity, run `Process Outbox`.
- No plan delta after acceptance:
  - verify decision succeeded (`accepted`) and room is active/entitled.

---

## 5) Evidence capture (for PR or issue comment)

Record:

1. Room ID and timestamp.
2. Recommendation status transition (`pending -> accepted/rejected`).
3. Plan delta summary (if accepted).
4. Outbox status summary after task actions.
5. Any non-pass outcome and exact API error text.

---

## 6) Revision history

| Date | Change |
| --- | --- |
| 2026-04-24 | Initial Phase 3 mobile staging checklist for WS3 task execution and WS4 incident/recommendation loop. |
