# iOS simulator agent QA

Short policy for agent-driven mobile validation. **Evidence lives on the PR only** (screenshots/comments), not in this doc tree.

## When required

Any change to **`apps/mobile/**`** that affects what users see or tap (map, tabs, notices, navigation, auth entry).

## Flow

1. `npm run agent:ios:ready`
2. XcodeBuildMCP: `snapshot_ui` → tap by label → assert → screenshot
3. Fail → fix → repeat (max 5 iterations)
4. `npm run verify` before PR ready

## Blocked in sim?

Stop. Do not mark done. Report blocker + **options to proceed** (deeplink, Maestro, rebuild dev client, test account, staging). Remove blockers over time so agents need no human step.

## Config

- `.xcodebuildmcp/config.yaml` — shared workspace/scheme/bundleId; **`simulatorName` only** (no committed UUID)
- Skill: `.cursor/skills/ios-simulator-agent-qa/SKILL.md`
- Rule: `.cursor/rules/mobile-simulator-agent-qa.mdc`

## Regression

Stable flows → `apps/mobile/.maestro/`. Linux CI does not run the sim; macOS author/agent runs smokes locally.
