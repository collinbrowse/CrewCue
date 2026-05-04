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

- Last updated: 2026-05-01 (America/Chicago)
- Branch: `feature/issue-196-onboarding-overhaul` (tracks `origin/feature/issue-196-onboarding-overhaul`)
- Active issue: [#196](https://github.com/collinbrowse/CrewCue/issues/196) Production onboarding overhaul; [#198](https://github.com/collinbrowse/CrewCue/issues/198) Settings sign-out UX
- Active PR: [#197](https://github.com/collinbrowse/CrewCue/pull/197) OPEN (`feature/issue-196-onboarding-overhaul` → `main`), PR body includes **`Closes #196`** and **`Closes #198`** for merge auto-close
- Current priority: demo-first **Epic A**
- Sprint milestone: `Epic A Sprint 1 - Demo foundation`

## Current objective

Land onboarding + Auth0-backed demo paths behind **merge-ready PR #197**, then soak against Auth0 staging before production tenant promotion.

## Acceptance criteria (merge gate)

1. Guest landing replaces legacy auth-options funnel with consolidated intent semantics (`guestHomeAuthIntent.ts`), Amy-like hero, stacked Apple/Google/email/join-code entry, provider-aware chrome (`IdpAuthMarkButtons`).
2. Join-by-code wizard (`JoinCrewEntry` → `JoinCrewPreview` → `JoinCrewAccount`) plus athlete setup + one-time notifications gate align with secure-store onboarding keys and root gating in `apps/mobile/App.tsx`.
3. Anonymous join preview stays covered by contracts + API route + tests (already on branch baseline).
4. Settings exposes destructive **Sign out** with confirm / loading / error affordances (`WorkspaceMenuScreen` + `AuthedShellContext` typing).
5. CI parity: root **`npm run verify`** green after latest push.

## Delivered on branch (Epic A onboarding slice)

- **Landing & IdP UX:** `GuestHomeScreen` consolidation (removed `AuthOptionsScreen` route/file); Google raster buttons use letterboxed `contain` + column max width helper; guest-landing Apple black / Google light-chrome styling; onboarding runner + Google asset pack under `apps/mobile/assets/`.
- **Flows:** Join wizard + `AthleteSetupWizardScreen` + `OnboardingNotificationsScreen` polish; navigation types / `GuestStack` / theme tokens updated to match.
- **Sign-out (#198):** Account section sign-out UX in workspace menu.
- **Ops / CI:** Auth0 runbook updates; `.github/workflows/ci.yml` placeholder `EXPO_PUBLIC_AUTH0_CONNECTION_*` for `expo export` alignment with `loadMobileConfig()`.
- **Repo hygiene:** Removed accidental root `App.tsx` / `tsconfig.json` (Expo entry remains `apps/mobile` only).

## Next 1–3 tasks

1. **Merge #197** after green checks, human review of PR template sections (Decision tree, effects, acceptance mapping), and optional `smoke:mobile:ios` if navigation deep links regressed.
2. **Device smoke:** signup + join-by-code + notification one-time gate + Settings sign-out on a physical device or simulator build.
3. **Auth0 staging:** Run `docs/runbooks/auth0-and-social-idp-setup.md` against the real tenant; confirm `EXPO_PUBLIC_AUTH0_CONNECTION_*` parity; soak before production promotion.

## Validation summary

- `npm run verify` (root): **pass** after the final onboarding handoff commit (lint, typecheck, tests, mobile `expo export`, workspace builds).

## Open risks/blockers/questions

- Join preview payload may need stricter limits per final security posture.
- Auth0 connection names must match tenant + EAS secrets exactly (`EXPO_PUBLIC_AUTH0_CONNECTION_*`).
- Hero art is placeholder; swap assets without logic changes when ready.
- Sign-out clears local tokens; remote IdP session revocation is **not** in this slice.

## Guardrails

- Keep layering: contracts → api → client/sync → UI → docs.
- Server remains source of truth; secure-store keys only orchestrate onboarding intent.
- Keep Auth0 secrets in CI / secret manager; never commit secrets.

## Successor prompt

```text
PR #197 (onboarding overhaul) should be merge-ready: confirm checks green, template filled, Closes #196 and #198 in the body.
Run device smoke: guest landing IdP/email, join-by-code wizard, athlete setup, one-time notifications, Settings → Sign out.
If anything fails CI or smoke, fix on feature/issue-196-onboarding-overhaul and push; then execute Auth0 staging runbook and note parity gaps before prod.
```
