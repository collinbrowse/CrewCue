# UltraPacer vs CrewCue — feature gap analysis

**Issue:** #356  
**Sources:** [ultrapacer.com](https://ultrapacer.com/) public homepage + docs (`/docs/courses`, `/docs/plans`, `/docs/live`, `/docs/coaching`, `/docs/membership`, `/docs/models`), blog, Ascend Trail Running review (2025).  
**Date:** 2026-08-12  
**Scope:** public feature inventory + product recommendations. No product implementation in this branch.

---

## 1) Positioning (the real competitor frame)

| | **ultraPacer** | **CrewCue** |
| --- | --- | --- |
| Primary job | Athlete/coach **pace planning** for trail ultras | Crew **race-day operations** + simple AI finish/ETA plan |
| Primary surface | Web app | Mobile (Expo) + API |
| Strength | Course library + multi-factor pacing models + plan export | Roles, chat, tasks, incidents, projection, offline/outbox |
| Pacing approach | Manual knobs (heat, darkness, downhill skill, strategy curves, terrain factors) | **AI from athlete history** (past GPX and/or Strava) + course knowledge |
| Crew role | Secondary: share plan, notes, manual/live check-ins | Primary: operate the race together |

**Verdict:** UltraPacer is a planning competitor with light race-day crew tooling. CrewCue should include pacing, but **not** UltraPacer’s complexity: no athlete-facing heat/darkness/skill sliders. Instead, estimate finish time and aid ETAs from **who this athlete is** (prior activities) and **what this course is**. Win **crew coordination**; keep pacing **simple and personalized**.

---

## 2) UltraPacer feature inventory (public)

### Courses & course ops
- Searchable / copyable course database
- GPX upload + Strava route import
- Multi-step course editor: basics, source overrides, loops, reverse course
- Waypoints with tags: Aid Station, Water, Dropbag, Crew
- GPX/CSV waypoint import; map + elevation click-to-place
- Automatic trail-matching terrain detection + manual terrain factors
- Event start time, series association, cutoffs
- Public / searchable sharing + external links
- Race-admin: timing integrations (ultralive.net, opensplittime), forecast modes (pessimistic / neutral / optimistic), course records
- Org assignment (race organizer / FKT maintainer)

### Pacing plans
- Targets: elapsed time, average pace, or normalized pace
- Athlete factors: altitude, downhill skill, darkness skill
- Strategy: default fatigue curve or custom basic/advanced effort changes
- Optional heat model (baseline + peak vs sunrise/sunset)
- Typical aid delays + per-waypoint delay overrides
- Cutoff enforcement with margin; yellow/red cutoff highlighting
- A/B goal plans via copy; plan description
- Per-waypoint Athlete Notes vs Plan Notes (markdown)
- Hill effort customization

### Live / race day
- Active Mode window around event start/cutoff
- Manual crew check-in of arrival/departure → reprojected ETAs (beta)
- Automatic check-ins when timing configured + bib link
- Live Runner Mode forecasts vs plan
- Race Overview for spectators (leaderboard, field ETAs) — select timed events only

### Post-race & athlete tooling
- Compare GPX / Strava activity to plan (ahead/behind profile)
- Segment / climb / descent analysis
- GPX download for Garmin Virtual Partner
- PDF / print plan export (documented + third-party reviews)

### Coaching & platform
- Coach role: roster, invite athletes, per-athlete model settings
- Dashboard feed of athlete upcoming runs
- Membership Free / Plus / Pro via Stripe
- Embed on third-party sites; dark mode; avatars; dynamic sun shading on map
- Feedback hub (feature requests / bugs)

---

## 3) CrewCue baseline (current roadmap / product)

**Demo Epic A (must ship):** onboarding, Auth0 login, GPX → expected splits, crew create/invite, shared crew notes.

**Implemented / in-flight platform strengths:** race rooms, role guards, projection + checkpoint stoppage, task board, timeline, incidents + recommendations, outbox/sync/conflict, map + offline corridor work, Stream crew chat (plaintext MVP).

**Backlog depth:** live ops loops, incident→plan update hardening, multi-athlete manager board (WS6).

---

## 4) CrewCue pacing philosophy (simpler than UltraPacer)

**Product intent (owner):** pacing is in scope, but the UX/model stays simple. The system predicts expected finish time and aid ETAs from:

1. **Athlete history** — user uploads past GPX files and/or connects Strava so the model learns their real performance on similar effort / terrain / distance.
2. **Course knowledge** — distance, elevation, waypoints/aids for the target race.
3. **Optional light overrides only if needed later** — e.g. “conservative / on-pace / aggressive” — not UltraPacer’s full settings panel.

### Athlete UX (target simplicity)

1. Connect Strava **or** upload a few representative past activities (GPX).
2. Import / select the race course (GPX).
3. Get a **single primary output**: expected finish time + aid-station arrival schedule for the crew.
4. Optionally pick confidence band or A/B aggressiveness — not heat %, downhill skill, darkness skill, advanced strategy curves, terrain factor editors.

### What this replaces vs UltraPacer

| UltraPacer asks the athlete to… | CrewCue should… |
| --- | --- |
| Tune altitude / downhill / dark skill | Infer capability from past activities |
| Set heat baseline + peak | Infer or omit; don’t expose as primary UX |
| Define terrain factors section-by-section | Use course elev/distance (+ history match); no manual terrain editor for MVP |
| Choose elapsed vs avg vs normalized pace + strategy curves | Output one predicted finish + schedule; optional simple aggressiveness |
| Build a “plan science lab” | Build a **crew-ready ETA sheet** from “you + this course” |

### Guardrails

- Do **not** clone UltraPacer’s model UI or claim research-grade multi-factor physics.
- Prefer explainability in plain language (“Based on your last 3 long trail efforts and this course’s climb profile…”).
- Cold start: if no history yet, fall back to a coarse course-only estimate and prompt for GPX/Strava — don’t dump a settings form.
- Strava OAuth + activity sync is a product feature; treat privacy/scopes and athlete consent as first-class.
- AI pacing feeds the **same crew schedule / live reproject path** — one plan of record for ops, not a separate planner app.

---

## 5) Recommendations

### A. Incorporate (high value for CrewCue’s crew job)

Steal these as **crew-facing planning/ops artifacts**, not as a full UltraPacer clone:

1. **Crew schedule sheet** — aid arrivals as clock time + elapsed, with expected stoppage.
2. **Waypoint taxonomy** — Aid / Water / Dropbag / Crew-access tags on course points.
3. **Per-stop crew notes** — gear, nutrition, pacer pickup, drop-bag actions (markdown or structured).
4. **Per-stop delay overrides** — longer crew stop vs quick water fill.
5. **Cutoff awareness** — show margin vs cutoff; warn when projection threatens cutoffs.
6. **Live check-in → reproject ETAs** — align with existing projection/checkpoint path; make the UX crew-first on mobile.
7. **A/B or confidence bands** — conservative vs expected vs aggressive from the AI estimate (not UltraPacer strategy curves).
8. **Offline-printable crew sheet** (PDF/share) — table stakes when cell service dies.
9. **Plan share link / save-to-crew** — one link that boots the right room/plan for all members.
10. **History ingest** — GPX activity upload + Strava connect as inputs to the pacing estimate.

### B. Leave off (or defer hard)

Do **not** prioritize these for MVP/near-term differentiation:

1. Public searchable course marketplace / race directory
2. Race-director admin (official courses, course records, partner embeds)
3. Whole-field Race Overview / spectator leaderboards
4. Timing-company integrations (ultralive / opensplittime) until partnership demand exists
5. Deep coach roster product as a primary surface (secondary buyer)
6. Website embed widgets
7. Fancy map atmospherics (dynamic sun shading)
8. UltraPacer-style multi-factor knobs (heat / darkness / downhill skill / advanced strategy / manual terrain factors) as athlete UX
9. Garmin Virtual Partner as a top priority (athlete-watch job, not crew ops)
10. Membership tier feature-gating complexity before core crew loops are excellent

### C. Make better than UltraPacer (CrewCue wedge)

UltraPacer’s race-day crew story is still **web + shared plan + check-in times**. CrewCue should dominate:

1. **Personalized finish/ETA without settings homework** — history + course → answer.
2. **Mobile-native crew ops** in the dirt (UltraPacer compare flow is PC/tablet-oriented; product is web-first).
3. **Real-time crew chat** with photos, mentions, push — UltraPacer has notes, not ops messaging.
4. **Assigned tasks + ownership** at each stop (who brings what / who pacers / who drives).
5. **Incident capture → recommendation → plan delta** — UltraPacer updates ETAs; CrewCue should update *what the crew does*.
6. **Offline-first outbox** for remote canyons / mountains with spotty LTE.
7. **Role-aware controls** (crew chief vs member vs athlete) with clear disabled reasons.
8. **Push alerts** when ETA shifts or a check-in lands (“runner 18 min early to Robinson Flat”).
9. **Map navigation for crew logistics** (meet points, crew-access only stops), not just elevation plots.
10. Later: **multi-athlete crew board** (WS6) for crews/teams UltraPacer only covers via coach dashboards.

---

## 6) Priority stack (suggested product order)

| Priority | Item | Why |
| --- | --- | --- |
| P0 | Crew schedule + per-stop notes/delays | Closes the UltraPacer “crew knows when/what” gap |
| P0 | Mobile check-in → live ETA reproject | Matches their Live Runner Mode, in CrewCue’s ops path |
| P0 | Chat + push on ETA / check-in events | Differentiation UltraPacer cannot match quickly |
| P1 | AI finish/ETA from past GPX and/or Strava + course | Simpler pacing wedge; replaces UltraPacer knob farm |
| P1 | Cutoff warnings + confidence / A-B bands | Reduces crew surprises |
| P1 | Printable/offline crew sheet | Race-day resilience |
| P2 | Strava OAuth polish, richer history selection UX | Improves model input quality |
| P3 | Timing feeds / spectator overview / coach CRM | Adjacent markets |

---

## 7) Strategic takeaway

Treat UltraPacer as **complex planner competitor**; CrewCue as **simple personalized pacing + crew race-day OS**.

- Pacing: **include it**, but via **athlete history (GPX/Strava) + course → finish/ETA**, not UltraPacer’s settings lab.
- Crews should *live* in CrewCue: communicate, assign work, log reality, adapt the plan, stay synced offline.
- Incorporate UltraPacer’s **crew schedule + notes + live ETA** pattern; leave their **course marketplace / RD / spectator / deep model knobs** alone; beat them on **personalization simplicity + mobile ops**.

---

## 8) Validation notes

- Analysis is from public marketing + docs only (no paid login, no reverse engineering of proprietary model code).
- Plus vs Pro feature matrix exists in-product Settings; exact price points and gated features not fully enumerated publicly in docs reviewed.
- Third-party Ascend review (Jan 2025) states pacing plan generation works without an account and PDF/print is part of the workflow.
- CrewCue AI-pacing approach above is **product direction from owner** (2026-08-12), not yet an implemented system.
