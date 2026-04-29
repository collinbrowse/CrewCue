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

- Last updated: 2026-04-29 (UTC-6)
- Branch: `feature/issue-187-gpx-import-splits`
- Active PR: pending creation (`Closes #187`)
- Active issue: #187 (Sprint 1: GPX import to expected split times)
- Current priority: demo-first **Epic A**
- Current sprint milestone: `Epic A Sprint 1 - Demo foundation`
- Epic tracker: #182

## Current objective

Deliver Sprint 1 demo flows:

1. onboarding + normal login
2. GPX import -> expected split times
3. crew creation + invites
4. shared crew notes
5. visual polish across demo-critical screens

## Completed in this session

1. Added a full GPX import feature module in `apps/mobile/src/features/gpx/gpxImport.ts` with track parsing/validation, distance computation, expected split generation, and presenter-friendly formatting helpers.
2. Added GPX unit tests in `apps/mobile/src/features/gpx/gpxImport.test.ts` and wired them into the mobile test script in `apps/mobile/package.json`.
3. Added `apps/mobile/src/navigation/GpxImportScreen.tsx` using `expo-document-picker` + `expo-file-system` to import GPX files, compute expected splits, and render loading/success/error guidance.
4. Integrated the new screen into Readouts navigation via `apps/mobile/src/navigation/types.ts`, `apps/mobile/src/navigation/ReadoutsStack.tsx`, and `apps/mobile/src/navigation/AuthenticatedReadoutsScreen.tsx`.
5. Ran validation for touched scope and full repo verify (`npm run test -w @crewcue/mobile`, `npm run typecheck -w @crewcue/mobile`, `npm run verify`).

## Next 1-3 tasks

1. Open and merge PR for #187 after review/checks, then move #187 project status forward.
2. Start #184 (Sprint 1: Crew creation + member invite workflow) as the next demo-critical user-visible flow.
3. Keep non-demo scope in Backlog unless explicitly reprioritized.

## Validation summary

- `npm run test -w @crewcue/mobile`: pass
- `npm run typecheck -w @crewcue/mobile`: pass
- `npm run verify`: pass

## Open risks/blockers/questions

- GPX import currently requires timestamped `<trkpt><time>` data; files without timing metadata intentionally return actionable guidance instead of inferred pacing.
- GPX import was validated via tests/builds but still needs final on-device manual confirmation with a real demo GPX file chooser flow.
- Existing unstaged user change remains in `docs/sdlc/mvp-ui-development-spec.md` (left untouched).

## Guardrails

- Keep layering: contracts -> api -> client/sync -> UI -> docs.
- Do not duplicate API client/outbox execution paths.
- Keep server state authoritative; UI state is derived/intent/ephemeral only.
- Keep docs concise; completed history lives in `docs/sdlc/archive-completed-work-summary.md`.

## Successor prompt

```text
Continue CrewCue on Epic A Sprint 1 (demo-first).
Read: agent-handoff.md -> README.md -> token-budget.md -> mvp-ui-development-spec.md -> ui-delivery-roadmap-and-spec.md.
Complete PR lifecycle for #187 (GPX import + expected splits) if still open, including project status updates.
Then start #184 (crew creation + invites), implement the largest safe complete sprint slice, run npm run verify, and open/update a PR with Closes #184 and full required template sections.
```
