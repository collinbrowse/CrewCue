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
2. Run from repo root: **`npm run agent:ios:ready`**. If it fails, follow printed fixes; do not skip to "manual testing."
3. Install XcodeBuildMCP + Cursor MCP (`xcodebuildmcp mcp`) if tools are missing — report as blocker on non-macOS hosts.

## Test entry (prefer automation)

| Goal | Entry |
|------|--------|
| Map / guest shell | `crewcue://guest` via `simctl openurl` or `npm run smoke:mobile:ios` |
| Operate / readouts | `crewcue://operate`, `crewcue://readouts` (see `scripts/mobile-ios-deeplink-smoke.mjs`) |

Auth0 login in sim is a **blocker** until a deeplink or test fixture exists — stop and list options (see rule `mobile-simulator-agent-qa.mdc`).

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
