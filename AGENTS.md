# AGENTS.md

## Fast path (default)

Implement → verify → done. Skip issue creation, handoff edits, and SDLC doc packs unless the task is multi-session, cloud/staging, an `agent-ready` work package, or the user asks for continuity.

## When to load more

- **Mobile UI** (`apps/mobile/**`): `.cursor/rules/mobile-simulator-agent-qa.mdc` + skill `.cursor/skills/ios-simulator-agent-qa/SKILL.md`. Run `npm run agent:ios:ready` before XcodeBuildMCP. Simulator proof on the PR before claiming done.
- **XcodeBuildMCP:** Use the installed XcodeBuildMCP skill/docs before calling MCP tools.
- **Handoff / waves / issues / staging:** pull the matching `.cursor/rules/*.mdc` by description when needed; do not assume they are always on.
- **Continuity snapshot:** `docs/sdlc/agent-handoff.md` (PR/wave boundaries only).
