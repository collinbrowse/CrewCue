# Token budget and context window policy

Preserve quality while minimizing unnecessary context.

Principle: pass only what the next task needs.

---

## Fast path (default)

Most tasks: implement → `npm run verify` (or scoped tests) → done.

Do **not** require reading the full SDLC pack, restating scope in 8 bullets, opening an issue, or updating handoff for trivial/drive-by work.

---

## When to load more context

| Situation | Read |
|-----------|------|
| Multi-session / PR continuity | `docs/sdlc/agent-handoff.md` |
| Agent work package / wave | Issue body + `agent-async-delivery-program.md` |
| Mobile UI | ios-simulator skill + mobile rule (path-triggered) |
| Cloud beyond baseline | `staging-first-cloud-delivery.md` |

Prefer `@`-mentioning or opening the relevant rule over always-on ceremony.

---

## Soft budgets

- New-agent kickoff prompt: <= 25 lines when handoff matters.
- Active `agent-handoff.md`: <= 250 lines; current state only.
- "Next tasks" in handoff: max 3.
- End-of-task summary: short; status, evidence, next 1–3 steps.

---

## Anti-patterns

- Mandatory "read every SDLC doc" at chat start.
- Long pasted history in each prompt.
- Updating handoff after every one-line fix.
- Keeping stale completed narrative in active handoff.
