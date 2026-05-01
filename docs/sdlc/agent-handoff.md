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

- Last updated: 2026-05-01 (UTC-6)
- Branch: `feature/issue-196-onboarding-overhaul`
- Active issue: #196 (Production onboarding overhaul)
- Active PR: pending creation (`feature/issue-196-onboarding-overhaul` -> `main`)
- Current priority: demo-first **Epic A**
- Sprint milestone: `Epic A Sprint 1 - Demo foundation`

## Current objective

Deliver onboarding + login demo path with production-minded Auth0 wiring:

1. New landing + auth option screens
2. Join-by-code 3-page wizard + preview endpoint
3. Athlete setup wizard with GPX + splits
4. One-time notifications gate
5. Auth0 automation + manual IdP runbook

## Completed in this session

1. **Mobile onboarding replacement**
   - Replaced legacy staged guest flow with new GuestStack screens:
     - `GuestHomeScreen` (CrewCue landing with 3 CTA buttons)
     - `AuthOptionsScreen` (Google/Apple/Email for sign-in and sign-up)
     - `JoinCrewEntryScreen` -> `JoinCrewPreviewScreen` -> `JoinCrewAccountScreen`
     - `AthleteSetupWizardScreen` (3-step setup + GPX + split preview + room/course save)
     - `OnboardingNotificationsScreen` (one-time per-device notification prompt)
2. **Onboarding state model**
   - Added secure-store keys in `onboardingState.ts` for intent, join draft, notification seen/required flags.
   - Updated `App.tsx` root gating to use pending athlete setup/join completion/notifications logic.
3. **Auth0 provider-specific auth**
   - Extended `useAuth.ts` with provider-aware methods (`google`, `apple`, `email`) for both sign-in and sign-up.
   - Added new required mobile config vars and `.env.example` values for connection names.
4. **Join preview API + contract**
   - Added `RaceRoomJoinPreview` contract types in `packages/contracts`.
   - Added anonymous `GET /race-rooms/join-preview/:roomCode` in `services/api` with generic 404 semantics and basic in-memory rate limiting.
   - Added API test for anonymous preview route.
5. **Auth automation + documentation**
   - Added Terraform Auth0 staging baseline: `infra/terraform/auth0/staging/*`.
   - Added Management API bootstrap script: `scripts/auth0/bootstrap-connection-config.mjs` and root npm script.
   - Added detailed manual runbook: `docs/runbooks/auth0-and-social-idp-setup.md`.

## Next 1-3 tasks

1. Open PR for #196 with `Closes #196` and request review.
2. Run on-device manual smoke for onboarding paths (signup, join, repeat on same device notification behavior).
3. Validate Auth0 staging apply/runbook against real tenant values, then promote to production tenant after soak.

## Validation summary

- `npm run typecheck` (root): pass
- `npm test` (root): pass
- `npm run verify` (root): pass

## Open risks/blockers/questions

- Join preview endpoint currently returns sanitized geometry/checkpoint data but may still need stricter limits depending on final security policy.
- Provider connection names must exactly match Auth0 tenant configuration (`EXPO_PUBLIC_AUTH0_CONNECTION_*`).
- Hero illustration is a placeholder; production art can be swapped without code changes.

## Guardrails

- Keep layering: contracts -> api -> client/sync -> UI -> docs.
- Server remains source of truth; secure-store keys only orchestrate onboarding intent.
- Keep Auth0 secrets in CI/secret manager; do not commit secrets to repo.

## Successor prompt

```text
Continue #196 onboarding rollout from branch feature/issue-196-onboarding-overhaul.
Confirm PR is open with Closes #196, re-run npm run verify if new commits land,
and complete device-level smoke for signup/join/notification one-time behavior.
Then apply Auth0 runbook steps to staging tenant and capture parity notes.
```
