# Agent handoff source of truth

Update at **PR/wave boundaries**, not every chat. Current state only. Feature agents: PR **Handoff delta** only.

## Snapshot

- Last updated: 2026-09-12 (UTC)
- **On `main`:** Process slim (#488/#489) + agent harness gates in flight (#490): Ready/Done scripts, scoped verify, hooks, Ready lint Action, `crewcue://dev/pace-estimate`.
- **Active feature line:** `feature/pacing-accuracy-program` for pacing product; prefer that branch/PR for pacing detail until merged.
- **Process:** Fast path default; machine gates (`agent:issue:ready`, `agent:pr:done`, `agent:ios:ready`) over prose re-reads.

## Next 1-3 tasks

1. Merge #490 (agent harness gates) when CI green.
2. Land / merge pacing accuracy program from `feature/pacing-accuracy-program`.
3. After pacing merge: real-effort `npm run pacing:backtest` fixture + tune constants from evidence.

## Blockers

- Production-auth mobile paths still need Auth0; schedule/pace **fixture** proof uses `crewcue://dev/*` (no login).
- Leave unrelated stashes alone.

## Successor prompt

```text
Prefer fast path + machine gates (agent:issue:ready / agent:pr:done / scoped verify:*).
For pacing product: feature/pacing-accuracy-program. After #490 merge: use Auth0-free
crewcue://dev/pace-estimate|schedule-sheet for sim proof. Integration agent owns handoff.
```
