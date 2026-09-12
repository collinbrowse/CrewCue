# iOS simulator agent QA

Short policy for agent-driven mobile validation. **Evidence lives on the PR only** (screenshots/comments), not in this doc tree.

## When required

Any change to **`apps/mobile/**`** that affects what users see or tap (map, tabs, notices, navigation, auth entry).

## Flow

1. `npm run agent:ios:ready` (hard-fails if Metro down; prints `simulatorId` + next steps)
2. Prefer Auth0-free deeplinks: `crewcue://dev/schedule-sheet`, `crewcue://dev/cold-start`, `crewcue://dev/pace-estimate` (`--deeplink …`)
3. XcodeBuildMCP: `snapshot_ui` → tap by label → assert → screenshot
4. Fail → fix → repeat (max 5 iterations)
5. Scoped `verify:mobile` mid-slice; full `npm run verify` before PR ready
6. `npm run agent:pr:done -- <pr>` before claiming Done

## Blocked in sim?

Stop. Do not mark done. Report blocker + **options to proceed**. Prefer extending `__DEV__` `crewcue://dev/*` fixtures over Auth0 login.

## Config

- `.xcodebuildmcp/config.yaml` — shared workspace/scheme/bundleId; **`simulatorName` only** (no committed UUID)
- Skill: `.cursor/skills/ios-simulator-agent-qa/SKILL.md`
- Rule: `.cursor/rules/mobile-simulator-agent-qa.mdc`

## Regression

Stable flows → `apps/mobile/.maestro/`. Linux CI does not run the sim; macOS author/agent runs smokes locally.
