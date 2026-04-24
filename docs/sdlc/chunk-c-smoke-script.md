# Chunk C — End-to-end smoke script (staging)

**Audience:** engineers and operators validating the Chunk C exit gate against the Railway staging API.  
**Strategy ref:** [mvp-delivery-chunks-and-cloud-strategy.md](./mvp-delivery-chunks-and-cloud-strategy.md) §Chunk C exit criteria.  
**Prerequisites:** Chunk A (Postgres persistence) and Chunk B (Auth0 + entitlement) green on staging.
**Phase 3 follow-up:** [mobile-phase3-staging-validation-checklist.md](./mobile-phase3-staging-validation-checklist.md)

---

## Exit criteria (from strategy doc)

> Scripted smoke demo documented in-repo: **sign-in → paid active room → ping → crew sees projection → task lifecycle → incident loop (as applicable).**

All steps below cover this criteria from the mobile smoke screen (`apps/mobile/App.tsx`).

---

## Smoke steps

Run the following in order in a single app session. Each step maps to a button on the smoke screen.

### 1. Sign in

- Open the app.  
- Verify **Redirect URI** shows `crewcue://auth`.  
- Tap **Sign in with Auth0** → complete Auth0 Universal Login in the system browser.  
- **Pass:** `sub`, `email`, `team_ids`, and `room_roles` appear on screen. No `null` on `team_ids` / `room_roles` (the Post Login action is wired).

### 2. Create race room

- Tap **Create race room (staging)**.  
- **Pass:** room card shows a UUID and `draft / unpaid`.

### 3. Mark entitlement paid

- Tap **Mark entitlement paid (staging)**.  
- **Pass:** entitlement row updates to `paid`.

### 4. Fetch room (GET)

- Tap **Fetch room (GET)**.  
- **Pass:** room name, `draft / paid`, and a `permissions` JSON object appear.

### 5. Activate room

- Tap **Activate room (staging)** (visible once room is `paid + draft`).  
- **Pass:** room status card updates to `active`. `eventEndsAt` is set to now + 4 h.

### 6. Send ping

- Tap **Send ping (staging)** (visible once room is `active`).  
- **Pass:** last-ping card shows `accepted` (green) and a `pingId`.

### 7. Fetch projection

- Tap **Fetch projection (GET)**.  
- **Pass:** projection card shows `confidence`, `progressMeters`, and `etaFinishPlanIso`. Confidence is `fresh` if the ping was recent.

> **Note:** projection requires at least one accepted ping. If you tap this before step 6 you will see **404 Projection not available** — that is correct behaviour.

### 8. Post protocol note

- Tap **Post protocol note (staging)**.  
- **Pass:** protocol note card shows the returned `id`, `category: nutrition`, and `checkpointId`.

> The smoke uses the first checkpoint from the activated course (`DEFAULT_RACE_COURSE`). If the room has no course, the stub `cp-smoke-1` is used and the API accepts it as an unknown-checkpoint write (it does not validate checkpoint membership for protocol notes on the default course).

### 9. Fetch ops timeline

- Tap **Fetch ops timeline (GET)**.  
- **Pass:** timeline card shows ≥ 1 event, most recent is `protocol_updated: Protocol updated (nutrition)` from step 8.

### 10. Fetch task board

- Tap **Fetch task board (GET)**.  
- **Pass:** task count is shown. For a freshly activated room this will be 0 — that is expected (tasks are created by crew, not seeded automatically). Confirm no error.

---

## Full pass criteria

All 10 steps pass with **no crash** and **no unexpected error** in the API error row.  
Steps 1–9 exercise: Auth0, room lifecycle, entitlement gate, WS2 ping ingest, WS2 projection read, WS3 protocol note write, WS3 ops timeline read, WS3 task board read.

---

## Known limitations (MVP scope)

| Area | Limitation | Planned |
| --- | --- | --- |
| Task lifecycle | Tasks are not seeded; crew-side create/assign/start/complete is not in the mobile smoke | Chunk D (WS3 depth) |
| Incident loop | Not covered by mobile smoke; API routes exist | Chunk D |
| WS5 sync health | Heartbeat / reconnect path not in smoke screen | Chunk D (D2) |
| Projection polling | Single on-demand GET; no background loop | Chunk D (D1) |
| Offline | No queue or retry; requests fail silently on network loss | Chunk D (D2) |

---

## Revision history

| Date       | Change |
| ---------- | ------ |
| 2026-04-21 | Initial publication — covers slices 1–5 of Chunk C (issues #82–#89). |
| 2026-04-24 | Linked dedicated Phase 3 mobile staging validation checklist for WS3/WS4 depth loops. |
