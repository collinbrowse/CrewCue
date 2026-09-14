# Agent handoff source of truth

Update at **PR/wave boundaries**, not every chat. Current state only. Feature agents: PR **Handoff delta** only.

## Snapshot

- Last updated: 2026-09-14 (UTC)
- **On `main`:** Pacing accuracy #485 (#481–#484, #487) + agent harness gates #491 (#490).
- **Process:** Fast path default; machine gates `agent:issue:ready` / `agent:pr:done` / scoped `verify:*` / hardened `agent:ios:ready`.
- **Active next:** Single field validation (real backtest fixture).

## Completed (merged)

- #485: history → plan wiring, backtest CLI, model C1–C4, aid dwell, estimate recompute/projection refresh.
- #491: Ready/Done scripts, scoped verify, Cursor hooks, Ready lint Action, `crewcue://dev/pace-estimate`.
- Auth0-free sim proof: `crewcue://dev/pace-estimate` on guest stack (2026-09-14) — cold-start DEV fixture; no login.

## Next 1-3 tasks

1. **Single field validation:** add `fixtures/pacing/backtest-<real>.json` from a completed effort, run `npm run pacing:backtest`, tune C1/C2 against evidence.
2. Staging/device smoke: recalculate from history → Pace tab clocks match schedule.
3. (Optional) Re-sign into sim if you need production-auth Pace tabs — AsyncStorage was cleared for guest deeplink QA.

## Validation evidence

- #485 / #491 on `main` (`0666ef8`).
- Sim: `agent:ios:ready -- --deeplink crewcue://dev/pace-estimate` → “Pace estimate (DEV)” + cold-start banner (local evidence under `.agent-pr-evidence/`, not committed).

## Blockers

- Model constants provisional until real-effort backtest.
- Production-auth mobile paths still need Auth0; **fixture** schedule/pace proof does not (`crewcue://dev/*`). Guest DEV routes require guest stack (clear session or sign out if already authed).
- Leave unrelated stashes alone.

## Successor prompt

```text
main has #485 + #491. Next: fixtures/pacing/backtest-<real>.json + npm run pacing:backtest;
tune GAIN_FLAT_EQUIVALENT / RIEGEL_ENDURANCE from evidence. Auth0-free sim already proven via
crewcue://dev/pace-estimate (guest stack). Use agent:issue:ready / agent:pr:done.
```
