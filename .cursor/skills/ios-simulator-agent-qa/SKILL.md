---
name: ios-simulator-agent-qa
description: >-
  Boot iOS simulator, run XcodeBuildMCP UI automation, fix-and-retest until
  mobile acceptance criteria pass. Use for any apps/mobile UI task or when the
  user asks to verify on simulator.
---

# iOS simulator agent QA

## Before UI automation

1. Read `.xcodebuildmcp/config.yaml` (workspace, scheme, `simulatorName`, `bundleId`).
2. Run from repo root: **`npm run agent:ios:ready`**. Hard-fails if Metro is down (override: `--allow-no-metro`). Do not skip to "manual testing."
3. Auth0-free entries (guest stack, `__DEV__` only):

| Goal | Deeplink |
|------|----------|
| Guest shell | `crewcue://guest` (default) |
| Map aid pager / crew ops | `crewcue://dev/schedule-sheet` (Previous aid / Next aid, expand, Edit delay & notes, Open check-in, Share crew sheet) |
| Pace estimate / cold-start | `crewcue://dev/cold-start` or `crewcue://dev/pace-estimate` |
| Crew sheet export | `crewcue://dev/crew-sheet-export` |

Example: `npm run agent:ios:ready -- --deeplink crewcue://dev/pace-estimate`

4. Install XcodeBuildMCP + Cursor MCP if tools are missing — report as blocker on non-macOS hosts.

## Test entry (prefer automation)

| Goal | Entry |
|------|--------|
| Map / guest shell | `crewcue://guest` via `simctl openurl` or `npm run smoke:mobile:ios` |
| Operate / readouts | `crewcue://operate`, `crewcue://readouts` (see `scripts/mobile-ios-deeplink-smoke.mjs`) |

Prefer `__DEV__` `crewcue://dev/*` fixtures over Auth0 login for schedule/pace proof. Auth0 login remains a **blocker** for production-auth paths only — stop and list options (see rule `mobile-simulator-agent-qa.mdc`).

## XcodeBuildMCP loop

1. **`snapshot_ui`** — find targets by `AXLabel` (match app `accessibilityLabel`).
2. **`tap --label "…"`** (or coordinates only if no label).
3. Wait for transient UI (notices): poll `snapshot_ui` every ~0.5–1s for up to ~5s.
4. **`screenshot`** on failure and on final pass.
5. Compare to issue acceptance criteria text.

CLI example (use `simulatorId` from `agent:ios:ready` output if name resolution fails):

```bash
xcodebuildmcp ui-automation tap --simulator-id "$UDID" --label "Center map on your location"
```

## Maestro

If `apps/mobile/.maestro/*.yaml` covers the flow, run it before claiming done. Add Maestro when the same flow is validated twice.

## Evidence → PR only

- Attach screenshots and short `snapshot_ui` quotes to the **PR** (body or comment).
- Optional local folder `.agent-pr-evidence/` — **never commit**.

## When blocked

Stop and report: blocker, partial evidence, and numbered **options to proceed** (code/setup/product). Do not imply the feature works.
