# Agent handoff source of truth

Use this as the minimal continuity file between sessions.

## Required read order

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. `docs/sdlc/token-budget.md`
4. `docs/sdlc/mvp-ui-development-spec.md`
5. `docs/sdlc/ui-delivery-roadmap-and-spec.md`
6. `.cursor/rules/github-pr-issue-workflow.mdc`
7. `.github/pull_request_template.md`

## Session status snapshot

- Last updated: 2026-05-04 (America/Chicago)
- Branch: `feature/issue-199-auth-visual-rollout`
- Active issue: [#199](https://github.com/collinbrowse/CrewCue/issues/199) signup/login visual system rollout across `apps/mobile`
- Active PR: none yet for issue #199
- Current priority: demo-first **Epic A** UI consistency follow-through
- Sprint milestone: `Epic A Sprint 1 - Demo foundation`

## Current objective

Apply the signup/login visual language across mobile auth + authenticated surfaces with high-fidelity styling parity, while preserving onboarding and settings behavior.

## Acceptance criteria (merge gate)

1. Design-system/theme tokens and shared controls encode the signup/login style primitives.
2. Shell + navigation chrome match the refreshed auth visual language.
3. Onboarding/auth-adjacent screens use the new style system with reduced hardcoded drift.
4. Key authenticated surfaces (`Operate`, workspace menu, member/join flows) align to the same visual system.
5. CI parity: root **`npm run verify`** green after latest push.

## Delivered on branch (issue #199 slice)

- Extended `DSThemeTokens` with auth-focused color primitives and applied them across `DSButton`, `DSTextInput`, `DSCard`.
- Updated navigation and shell chrome (`navigationTheme`, `OperateStack`, `ReadoutsStack`, `App.tsx` style factories) to auth-style palette/shape hierarchy.
- Migrated onboarding/auth flows (`GuestHomeScreen`, `JoinCrewEntry`, `JoinCrewPreview`, `JoinCrewAccount`, `AthleteSetupWizardScreen`, `OnboardingNotificationsScreen`) to token-driven signup/login styling.
- Migrated key authenticated surfaces (`AuthenticatedOperateScreen`, `WorkspaceMenuScreen`, `ManageRoomMembersScreen`, `JoinRoomDetailsScreen`) to matching visual treatment and reduced hardcoded color drift.

## Next 1-3 tasks

1. Run manual mobile smoke on-device/simulator to confirm visual parity + onboarding/settings behavior after the style pass.
2. Open PR for `feature/issue-199-auth-visual-rollout` with `Closes #199` and include before/after screenshots for key screens.
3. Address any visual regressions from review (especially IdP button compliance and dark/light consistency checks).

## Validation summary

- `npm run verify` (root): **pass** on `feature/issue-199-auth-visual-rollout` after UI refresh changes (lint, typecheck, tests, mobile `expo export`, workspace builds).

## Open risks/blockers/questions

- Apple/Google provider button brand constraints still require strict visual compliance; avoid over-customizing branded internals.
- Additional non-targeted screens may still contain legacy hardcoded color constants outside this issue #199 scope.
- Manual visual QA on physical devices remains pending to catch spacing/font rendering differences.

## Guardrails

- Keep layering: contracts → api → client/sync → UI → docs.
- Server remains source of truth; secure-store keys only orchestrate onboarding intent.
- Keep Auth0 secrets in CI / secret manager; never commit secrets.

## Successor prompt

```text
Continue on feature/issue-199-auth-visual-rollout.
Run focused mobile smoke for GuestHome, JoinCrew flow, AthleteSetup, Notifications, Operate, Workspace Menu, Manage Members, Join Room Details.
If UI regressions appear, fix them and open a PR to main with Closes #199 and screenshot evidence.
```
