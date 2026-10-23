# Agent handoff source of truth

Update at **PR/wave boundaries**, not every chat. Current state only. Feature agents: PR **Handoff delta** only.

## Snapshot

- Last updated: 2026-10-16 (UTC)
- **Clients are native.** iOS SwiftUI (`apps/ios`) and Android Compose (`apps/android`) share behaviour through the Swift core in `packages/client-core`. Android consumes that core over JNI: Swift Android SDK cross-compile, `scripts/build-swift-android.mjs`. Expo and `apps/mobile` were removed; do not add them back.
- **Parity source of truth:** `clients/behavior/**` checklists plus `deeplinks.json`. A `pass` needs a device proof file. Native race day is unfinished while checklist rows are `fail`.
- **API:** Fastify on Railway (`railway.toml`), with Postgres or memory persistence and Auth0 RS256 (staging tenant).
- **Release pipeline:** `npm run release -- X.Y.Z` → `.github/workflows/release.yml` → TestFlight and the Play internal track. It is blocked on the owner's secrets and config: see `docs/release/readiness.md` "Needs you".
- **Process:** Fast path default. Machine gates are `agent:issue:ready`, `agent:pr:done` (includes `pr-decision-doc-guard`), scoped `verify:*`, `agent:ios:ready` and `agent:android:ready` (dev deeplinks need a **Debug** build).
- **Latest on `main`:** Cairn loaders, shared, iOS and Android (#555, #556, #559).

## In flight: weekend wave (2026-10-16)

Six parallel sessions, each in its own worktree and each ending in an open PR for owner review. Nothing merges without the owner.

| Session | Area | Branch | PR scope |
| --- | --- | --- | --- |
| A | Runner progress from the runner's phone | `claude/runner-progress-from-athlete-pings-e95a83` | iOS `MapModel` and Android `MapViewModel` readouts and `AidStationSheet` read the latest athlete ping (AGENTS.md invariant) |
| B | Offline-safety invariants (#538) | `claude/client-core-offline-invariants-8958e9` | `packages/client-core` outbox, sessions and pings |
| C | Parity checklist device-proof sweep | `claude/parity-checklist-proof-sweep-44823b` | `clients/behavior/**` rows with device proof |
| D | Open PR queue cleanup | `claude/pr-queue-triage-2f8603` | Triage of Dependabot and older cursor PRs |
| E | Pacing evaluation and planned aid stops (#250) | `claude/pacing-evaluation-aid-stops-6400cd` | API pacing and the Pace edit screens |
| F | Release readiness | `claude/release-readiness-audit-d77b63` | `docs/release/readiness.md`. Dev links and dev sessions limited to Debug on both apps. iOS privacy manifest. Android R8. API production auth guard and log scrubbing. Issues #560–#571. |

Expected overlap when merging:
- A and F both touch Android `ShellViewModel.kt`. F only changes the `open()` line.
- B and F both touch client-core neighbours. F changes no client-core source.
- Merge order does not matter otherwise.

## Next 1-3 tasks (after the wave lands)

1. **TestFlight / Play internal unblock:** owner items 1–4 in `docs/release/readiness.md`, then #561 (per-environment build config) and #571 (Android target API 36).
2. **Store blockers:** #560 (account deletion), #569 (privacy policy and support links), #562 (background runner heartbeat).
3. **Production hardening:** #565 (rate limits), #566 (readiness check and migration ledger), #564 (crash reporting), #567 (secure token storage).

## Validation evidence

- Each wave PR carries its own `npm run verify` and `agent:pr:done` results, plus device screenshots (attached to the PR, not committed).

## Blockers

- Release builds point at localhost API and the dev Auth0 tenant until #561 and the owner's endpoint choice.
- Play rejects new apps below API 36 (#571), unless the owner requests the extension to 2026-11-01.
- Pacing model constants stay provisional until a real-effort backtest (`fixtures/pacing/backtest-<real>.json`).
- Leave unrelated stashes alone. The stash stack is shared across worktrees.

## Successor prompt

```text
Native clients only (apps/ios, apps/android, packages/client-core). Read docs/release/readiness.md
"Needs you" + issues #560–#571 for the release path. Weekend wave A–F PRs are open for owner review;
rebase on whatever merged. Use agent:issue:ready / agent:pr:done; device proof for UI changes.
```
