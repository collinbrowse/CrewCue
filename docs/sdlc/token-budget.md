# Token budget and context window policy

Use this policy to keep agent work high-signal and low-token.

---

## Core objective

Preserve implementation quality while minimizing unnecessary context carryover.

Principle: pass only what the next task needs, not everything that happened before.

---

## Hard budgets

- New-agent kickoff prompt: <= 25 lines.
- Active `agent-handoff.md`: <= 250 lines.
- "Next tasks" in handoff: max 3 tasks.
- Acceptance criteria in handoff: max 5 bullets.
- Agent pre-code restatement: <= 8 bullets.
- End-of-task summary: <= 10 bullets.

If a section grows beyond budget, trim or archive before continuing.

---

## Required context pack (minimum viable context)

Every new agent task should include only:

1. `docs/sdlc/agent-handoff.md`
2. `docs/sdlc/README.md`
3. Active issue/PR number
4. In-scope file paths
5. Out-of-scope systems
6. Acceptance criteria
7. Validation commands/manual checks

Do not paste large requirement blocks when files already exist in-repo.

---

## Read discipline

- Read canonical docs first.
- Read only 1-2 task-specific docs after that.
- Avoid broad "read all docs/sdlc" behavior unless blocked.
- Prefer targeted code/file lookups over wide scans.

---

## Handoff discipline

- Keep `agent-handoff.md` as rolling current state only.
- Move older narrative/session history into archive docs.
- Keep unresolved blockers/questions explicit.
- Always provide a short successor prompt with strict scope.

---

## Chat/session discipline

- Use one issue-sized objective per chat.
- Start a new chat when scope changes materially.
- Avoid multi-issue branching in a single conversation.
- Prefer short iterative checkpoints over long retrospective summaries.

---

## Anti-patterns to avoid

- "Read every doc and summarize everything."
- Long pasted history in each prompt.
- Re-explaining unchanged architecture every turn.
- Keeping stale completed tasks in active handoff.
- Expanding scope mid-task without updating handoff.
