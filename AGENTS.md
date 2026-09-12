# AGENTS.md

## Fast path (default)

Implement → scoped `verify:*` mid-slice → full `npm run verify` pre-PR. Skip issue creation, handoff edits, and SDLC doc packs unless multi-session, cloud/staging, `agent-ready`, or the user asks for continuity.

## Machine gates

- Ready: `npm run agent:issue:ready -- <n>`
- Done: `npm run agent:pr:done -- <pr>`
- iOS: `npm run agent:ios:ready` (Auth0-free: `--deeplink crewcue://dev/pace-estimate`)

## When to load more

- **Mobile UI** (`apps/mobile/**`): `.cursor/rules/mobile-simulator-agent-qa.mdc` + skill `.cursor/skills/ios-simulator-agent-qa/SKILL.md`. Simulator proof on the PR before claiming done.
- **XcodeBuildMCP:** Use the installed XcodeBuildMCP skill/docs before calling MCP tools.
- **agent-ready waves:** `.cursor/rules/agent-work-package-verification.mdc` (Ready script first).
- **Handoff / staging:** pull matching `.cursor/rules/*.mdc` by description when needed.
- **Continuity snapshot:** `docs/sdlc/agent-handoff.md` (integration agent / PR-wave boundaries; feature agents: PR Handoff delta only).
