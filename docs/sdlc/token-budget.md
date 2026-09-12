# Token budget and context window policy

Preserve quality while minimizing unnecessary context.

Principle: pass only what the next task needs.

---

## Fast path (default)

Most tasks: implement → scoped `npm run verify:api|mobile|contracts` mid-slice → full `npm run verify` pre-PR → done.

Do **not** require reading the full SDLC pack, restating scope in 8 bullets, opening an issue, or updating handoff for trivial/drive-by work.

---

## Machine gates (prefer over re-reading prose)

| Gate | Command | Token role |
|------|---------|------------|
| Ready | `npm run agent:issue:ready -- <n>` | ≤15-line stdout replaces Ready-section doc re-reads |
| Done | `npm run agent:pr:done -- <pr>` | Checklist fail/pass instead of Done-definition debate |
| iOS | `npm run agent:ios:ready` | Hard-fail Metro; prints next steps + Auth0-free deeplinks |

New harness docs must **replace** a longer read or be machine-gated. Do not add markdown agents must load without cutting something else.

---

## When to load more context

| Situation | Read |
|-----------|------|
| Multi-session / PR continuity | `docs/sdlc/agent-handoff.md` (integration agent writes; others: PR Handoff delta) |
| Agent work package / wave | Ready script → issue body; `agent-async-delivery-program.md` only if blocked |
| Mobile UI | ios-simulator skill + mobile rule (path-triggered); prefer `crewcue://dev/*` |
| Cloud beyond baseline | `staging-first-cloud-delivery.md` |

Prefer `@`-mentioning or opening the relevant rule over always-on ceremony.

---

## Soft budgets

- New-agent kickoff prompt: <= 25 lines when handoff matters.
- Active `agent-handoff.md`: <= 250 lines; current state only.
- "Next tasks" in handoff: max 3.
- End-of-task summary: short; status, evidence, next 1–3 steps.
- Hook / script messages: one line when possible.

---

## Anti-patterns

- Mandatory "read every SDLC doc" at chat start.
- Long pasted history in each prompt.
- Updating handoff after every one-line fix.
- Keeping stale completed narrative in active handoff.
- Soft Metro warnings that invite retry loops.
