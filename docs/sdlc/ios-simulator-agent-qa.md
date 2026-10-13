# iOS simulator agent QA

Short policy for agent-driven mobile validation. **Evidence lives on the PR only** (screenshots/comments), not in this doc tree.

## When required

Any change to **`apps/ios/**`** that affects what users see or tap. There is no Expo app.

## Flow

1. `npm run agent:ios:ready` (builds the SwiftUI app; prints `simulatorId` + next steps)
2. Prefer Auth0-free deeplinks from `clients/behavior/deeplinks.json` (`--deeplink …`)
3. XcodeBuildMCP: `snapshot_ui` → tap by label → assert → screenshot
4. Fail → fix → repeat (max 5 iterations)
5. Scoped `verify:ios` mid-slice; full `npm run verify` before PR ready
6. `npm run agent:pr:done -- <pr>` before claiming Done

## Blocked in sim?

Stop. Do not mark done. Report blocker + **options to proceed**. Prefer extending `__DEV__` `crewcue://dev/*` fixtures over Auth0 login.

## Config

- `.xcodebuildmcp/config.yaml` — `apps/ios` project, scheme, bundle id; **`simulatorName` only** (no committed UUID)
- Skill: `.cursor/skills/ios-simulator-agent-qa/SKILL.md`
- Rule: `.cursor/rules/mobile-simulator-agent-qa.mdc`

## Regression

Linux CI does not run the sim; macOS author/agent runs smokes locally.
