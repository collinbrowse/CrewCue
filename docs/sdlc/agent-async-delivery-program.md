# Agent async delivery program — UltraPacer gap + AI pacing

**Issue:** #356 (strategy source)  
**Audience:** humans launching waves; AI agents executing one work package each  
**Goal:** ship crew schedule ops + simple AI history pacing with **parallel agents**, each able to **fully prove** their slice (tests + verify + sim when UI), with **edge cases declared and covered up front**.

Related: [`../competitive/ultrapacer-feature-gap-analysis.md`](../competitive/ultrapacer-feature-gap-analysis.md)

---

## 1) Operating model (how async agents work)

```text
Wave 0 (serial unlock)
   └─ contracts + fixtures + labels + milestone
         │
         ├─ Wave 1 agents (parallel, contract-locked) ──► Integration agent W1
         ├─ Wave 2 agents (parallel after W1 merge) ───► Integration agent W2
         └─ Wave 3–4 agents …                          ► Integration agent
```

| Role | Responsibility | When |
| --- | --- | --- |
| **Planner (human or lead agent)** | File epic + child issues from this doc; set deps; mark Ready | Once per wave |
| **Work-package agent** | One GitHub issue → one branch → one PR; own tests + verify | Many in parallel |
| **Integration agent** | After wave merges: cross-package smoke, contract drift, handoff update | End of each wave |
| **Human** | Only for Auth0/Strava secrets, App Store, paid API keys, policy | Explicit blockers only |

### Hard rules

1. **One issue = one agent = one PR.** No multi-issue chats.
2. **No PR without a closed edge-case matrix** (every row: test or explicit “N/A + why”).
3. **Self-verify before “done”:** `npm run verify` always; mobile UI also `npm run agent:ios:ready` + simulator QA skill; API/contracts also package tests.
4. **Contract-first:** Wave 0 lands shared types/fixtures before parallel feature agents.
5. **Merge only when CI green** (`checks` + `dual-client-guard`). Rebase on `main`; no force-push to `main`.
6. **Do not claim done** if a human-only step blocked proof — file blocker comment with options (per mobile sim QA rule).

---

## 2) Definition of Ready (issue may be picked by an agent)

An issue is **Ready** only if it has all of:

- [ ] Objective (1–3 sentences)
- [ ] In-scope files / packages (bounded)
- [ ] Out of scope (explicit)
- [ ] Acceptance criteria (testable bullets, ≤ 8)
- [ ] **Edge-case matrix** (table; ≥ 5 rows for feature work; ≥ 3 for pure docs/infra)
- [ ] **Verification commands** (copy-pasteable)
- [ ] **Fixtures** named (or “create under `…` as part of this issue”)
- [ ] **Depends on** issue numbers (or `none`)
- [ ] **Conflicts with** paths other open PRs must avoid (or `none`)
- [ ] Labels: `agent-ready` + surface (`api` / `mobile` / `contracts` / `docs`) + wave (`wave-0` …)
- [ ] Successor prompt ≤ 25 lines (paste into next agent if blocked mid-flight)

If any checkbox is missing, agents **must refuse to implement** and comment `blocked: not Ready`.

---

## 3) Definition of Done (agent may stop)

- [ ] All acceptance criteria met
- [ ] Every edge-case row has a test, fixture assertion, or documented N/A
- [ ] `npm run verify` green locally
- [ ] Mobile UI: simulator proof on PR (not committed under `docs/`); harness green
- [ ] PR body: `Closes #<n>`, decision/assumption sections filled, verification evidence listed
- [ ] No new secrets in repo; Strava/Auth0 via env only
- [ ] `docs/sdlc/agent-handoff.md` updated **only by integration agent** (feature agents leave a short PR note for handoff delta)

---

## 4) Edge-case matrix (required shape)

Every feature issue includes this table (fill before coding):

| ID | Scenario | Expected | Proof (test / sim / N/A) |
| --- | --- | --- | --- |
| EC1 | … | … | `path/to/test.ts` or `sim: …` |
| EC2 | empty / missing input | … | … |
| EC3 | invalid / corrupt input | … | … |
| EC4 | auth / role denied | … | … |
| EC5 | offline / retry / conflict | … | … |
| EC6 | idempotent replay | … | … |
| EC7 | timezone / units | … | … |

**Minimum categories to consider** (delete only with N/A + reason): empty, invalid, unauthorized, offline, duplicate submit, clock/timezone, large payload, concurrent edit.

---

## 5) Shared fixtures (Wave 0 deliverable)

Create a durable fixture pack agents reuse (do not invent one-off GPX per PR):

| Fixture | Purpose |
| --- | --- |
| `fixtures/pacing/course-50k-with-aids.gpx` | Course + aid waypoints |
| `fixtures/pacing/activity-long-trail.gpx` | Athlete history sample |
| `fixtures/pacing/activity-short-road.gpx` | Dissimilar history (model should not overfit) |
| `fixtures/pacing/corrupt.gpx` | Parse failure |
| `fixtures/pacing/empty.gpx` | Empty track |
| `fixtures/pacing/schedule-expected.json` | Golden schedule for course+plan |
| `fixtures/pacing/strava-activity-summary.json` | Mock Strava payload (no live API in unit tests) |

Agents **must** prefer these paths; if a new fixture is needed, add it in the same PR with a one-line README entry.

---

## 6) Work-package DAG (what to implement)

### Wave 0 — Unlock (serial; 1–2 agents)

| ID | Work package | Depends | Verify |
| --- | --- | --- | --- |
| W0-1 | Contracts: waypoints tags, schedule stop, activity history ref, pacing estimate DTO | none | contracts build + type tests |
| W0-2 | Fixture pack + golden schedule helpers | W0-1 | fixture load tests |
| W0-3 | Labels/milestone + this program linked from epic; seed child issues Ready | none | docs/process only |

### Wave 1 — Crew schedule artifacts (parallel after W0)

| ID | Work package | Depends | Parallel? | Verify |
| --- | --- | --- | --- | --- |
| W1-1 | API: course waypoints CRUD + tags (Aid/Water/Dropbag/Crew) | W0 | Y | API tests + EC matrix |
| W1-2 | API: per-stop notes + delay overrides (plan-scoped) | W0, W1-1 | after W1-1 | API tests |
| W1-3 | API: schedule sheet projection (clock + elapsed + dwell) | W0, W1-1 | Y w/ W1-1 if contract-stable | golden fixture assert |
| W1-4 | Mobile: schedule sheet UI (read) | W1-3 | after W1-3 | sim QA + verify |
| W1-5 | Mobile: edit stop notes/delays | W1-2, W1-4 | after both | sim QA |
| W1-I | Integration: schedule E2E seed → sheet → note edit | W1-* | serial | verify + sim |

### Wave 2 — Live ETA + alerts (parallel after W1-I)

| ID | Work package | Depends | Parallel? | Verify |
| --- | --- | --- | --- | --- |
| W2-1 | Check-in arrival/departure → reproject future ETAs | W1-3 | Y | API golden + conflict EC |
| W2-2 | Push/chat notify on check-in + material ETA shift | W2-1 | after W2-1 | unit + optional staging |
| W2-3 | Mobile: check-in affordance + schedule refresh | W2-1 | Y w/ W2-2 after W2-1 | sim QA |
| W2-I | Integration: check-in moves ETA; crew sees update | W2-* | serial | verify + sim |

### Wave 3 — AI history pacing (parallel tracks after W0; wire after W1-3)

| ID | Work package | Depends | Parallel? | Verify |
| --- | --- | --- | --- | --- |
| W3-1 | Ingest past GPX activities → stored history | W0 | Y | corrupt/empty EC |
| W3-2 | Strava OAuth + activity sync (staging-first) | W0; secrets | Y | mock unit + staging manual blocker OK |
| W3-3 | Pacing estimate service: history + course → finish + aid ETAs | W0, W3-1 | after W3-1 | deterministic fixture tests (seeded model) |
| W3-4 | Wire estimate → schedule sheet (plan of record) | W1-3, W3-3 | after both | golden + UI |
| W3-5 | Cold-start UX (no history → coarse estimate + prompt) | W3-3 | Y w/ W3-4 | sim QA |
| W3-I | Integration: history → estimate → crew schedule | W3-* | serial | verify |

**Model constraint:** keep athlete UX simple (no UltraPacer knobs). Prefer **deterministic, test-seeded** estimator in CI; real LLM/API calls behind a port with recorded fixtures. Never flake CI on live model variance.

### Wave 4 — Hardening (after W2-I + W3-I)

| ID | Work package | Depends | Verify |
| --- | --- | --- | --- |
| W4-1 | Cutoff warnings on schedule / projection | W1-3, W2-1 | EC: on/under/over |
| W4-2 | Confidence / A-B bands from estimate | W3-3 | three-band fixture |
| W4-3 | Printable / shareable offline crew sheet | W1-4 | export snapshot test |
| W4-I | Full race-day smoke checklist | W4-* | staging + sim |

---

## 7) Parallelism & conflict map

| Path / package | Owning wave packages | Rule |
| --- | --- | --- |
| `packages/contracts/**` | W0-1 primarily; others only additive fields with approval | Prefer W0 PR; later agents extend via follow-up issue |
| `services/api/**/schedule*` | W1-3, W2-1 | Serialize if both open |
| `services/api/**/waypoints*` | W1-1, W1-2 | W1-2 waits for W1-1 merge |
| `apps/mobile/**/schedule*` | W1-4, W1-5, W2-3 | One mobile schedule PR at a time recommended |
| `services/api/**/pacing*` / `activities*` | W3-* | Parallel OK if different dirs |
| `docs/sdlc/agent-handoff.md` | Integration agent only | Feature PRs: “Handoff delta” section instead |

---

## 8) Agent kickoff prompt (copy per issue)

```text
You are executing ONE CrewCue work package.

Read in order:
1) docs/sdlc/agent-handoff.md
2) docs/sdlc/token-budget.md
3) docs/sdlc/agent-async-delivery-program.md
4) This issue body (acceptance + edge-case matrix + verify)

Rules:
- Implement only this issue. Do not expand scope.
- Fill any missing edge-case proofs with tests before claiming done.
- Run the Verification commands; paste results in the PR.
- Mobile UI: follow ios-simulator-agent-qa skill; evidence on PR only.
- If blocked by secrets/human-only steps: stop, comment options, do not fake pass.
- Open PR to main with Closes #<issue>.

Successor: leave a ≤25-line prompt for the next agent if incomplete.
```

---

## 9) Integration agent checklist (end of wave)

1. Merge all wave PRs (CI green).
2. Run `npm run verify` on `main`.
3. Run cross-package smoke from wave table.
4. Update `agent-handoff.md` (completed / next 1–3 / risks / successor).
5. Mark next wave issues `agent-ready` only if deps merged.
6. File bug issues for any EC gaps found (do not silently skip).

---

## 10) Launch steps (human / lead agent)

1. Merge #356 analysis PR (strategy baseline).
2. Create GitHub **Milestone**: `Crew schedule + AI pacing`.
3. Create **Epic issue** linking this doc + competitive analysis.
4. Create child issues from Wave 0 → 4 tables using template **Agent work package**.
5. Complete Ready checklist on Wave 0; run W0 agents.
6. After W0 merge: mark Wave 1 Ready; launch parallel agents (respect conflict map).
7. After each wave: run Integration agent before unlocking the next.

Optional: GitHub Project columns `Backlog / Ready / In progress / In review / Done` filtered by `wave-*` labels.

---

## 11) What we are explicitly not launching yet

- Public course marketplace, RD admin, Race Overview, timing feeds, coach CRM, Garmin VP, UltraPacer knob UI.
- Production Strava before staging OAuth soak (staging-first rule).
