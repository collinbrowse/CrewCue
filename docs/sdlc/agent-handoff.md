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

1. Finalized Sprint 1 Issue #187 upload flow polish in `apps/mobile/src/navigation/GpxImportScreen.tsx`:
   - successful file selection now replaces the upload CTA with compact file details only,
   - filename is shown in success green without extra surrounding text,
   - file detail row now shows distance + elevation gain and a `Select new file` action,
   - removed route summary/expected splits block from setup screen.
2. Shifted server course persistence to `Finish race setup` so upload parse succeeds first and room course sync occurs on finalize.
3. Removed local-only sync notice behavior from race setup flow.
4. Updated elevation copy to remove `vert` wording (`ft gain` label).
5. Validated with:
   - `npm run typecheck -w @crewcue/mobile`
   - `npm test -w @crewcue/mobile -- gpxImport`

## Next 1-3 tasks

1. Open PR for #187 with required template sections and `Closes #187`.
2. Run full repo `npm run verify` before merge.
3. Start #184 (Sprint 1: crew creation + member invite workflow) after #187 PR is in review.

## Validation summary

- `npm run typecheck -w @crewcue/mobile`: pass
- `npm test -w @crewcue/mobile -- gpxImport`: pass

## Open risks/blockers/questions

- Server course upload now occurs on `Finish race setup`; if finalize fails, route details remain local until retry.
- Final on-device visual smoke is still recommended before merge for issue #187.
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
Complete PR lifecycle for #187 if still open (required template sections + Closes #187 + checks review).
Then start #184 (crew creation + invites) as the next largest safe sprint slice.
```
