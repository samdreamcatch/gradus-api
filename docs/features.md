# Gradus — Features by User Type

## 🏋️ Coach

**Onboarding / Signup**

- Beta invite code gate; email+password or Google OAuth
- Multi-step onboarding: display name → sports coached → athlete levels per sport (with hr/wk) → invite-code share

**Roster & Athletes** (`coach.roster.tsx`)

- Segmented Schedule / Athletes view, sport-filter chips
- 8-char invite code dialog for parents
- **Week schedule view**: navigable week, lesson slots per athlete, color-coded by practice flow state
- **Lesson slot management**: create, edit, cancel single occurrence, reschedule occurrence, delete recurring
- **Athlete detail sheet**: parent name, goals, practice/lesson minutes, active plans, trends, AI-generated athlete summary (auto + refresh)
- Remove athlete from roster

**Plans** (`coach.plans.*`)

- Filters: Active / Drafts / Benched / Templates × athlete × sport
- Plan editor sheet: title, athlete assign, coach notes, moves from library (search), reorder, inline edit (name/description/cue/why/target reps or mins), save-to-library, remove
- Status: Activate / Bench / Delete (swipe); no cap on active plans per athlete (PRD #52)
- Templates (no athlete) → clone into real plans
- **Flow-state bars** for the plan (Frustrated / Pushing / Steady / Locked In / Flowing)
- **AI session summary** narrative
- **Voice FAB** (hold-to-record, ≤90s, ElevenLabs transcription):
  - Create mode: dictate entire plan, AI parses athlete + moves + targets + notes
  - Edit mode: voice-add/modify moves on open plan
  - Live waveform + timer, AI-touched fields highlighted with diffs
- Move library tab (browse/search/edit personal moves)

**Sessions / Lessons**

- **Pre-lesson briefing** (AI): own plan + cross-coach plans, practice logs since last lesson, recent messages, totals — content-hash cached, refreshable
- **Lesson wrap-up prompts** after slot end: Edit plan / Redeploy / Dismiss (one per athlete per day)

**Messages**

- Conversations list, three-way rooms (coach ↔ parent ↔ athlete)
- Text + voice notes, plan-tagged messages, real-time, unread badges

**Settings**

- Profile (name/email), Coaching (sports + levels + hr/wk), Invite code, Roster settings, Appearance (Light/Dark/Auto), Feedback, Sign out

---

## 👨‍👩‍👧 Parent

**Onboarding / Signup**

- Email+password, beta code, optional `?invite=` for a coach
- Multi-step: add athletes (name + birthdate, multiple) → goals per athlete (sport, current level, season goal, long-term goal) → practice schedule per athlete-coach (day, time, frequency: weekly / biweekly / twice monthly / monthly)
- Mid-flow recovery; `InviteCoachCard` if no coach yet

**Athletes** (Settings disclosures)

- Edit name/birthdate; copy athlete invite code; see account status
- **Coaches linked** per athlete: link by coach invite code (preview name), unlink, update sports
- **Primary coach** per sport
- Goals editor per sport
- Practice schedule editor per coach (days, times, frequency, start date)
- **Reset athlete password** (parent-issued)
- Add / remove athletes

**Plans** (`parent.plans.*`)

- Tabs: Plans / Goals
- Plans: filter Active / Benched × coach × sport
- Plan detail: moves with expandable How / What / Why
- **Plan session timer** (start/pause/resume/end, screen wake-lock)
- **Flow-state feedback modal** (5-point + note) on end, logs to `plan_sessions`
- "Message coach about this plan" → pre-tagged message
- Flow-state bars history

**Messages** — same shared room (text, voice notes, plan tags, real-time, unread badge)

**Resources** (`parent.resources.index.tsx`)

- **Library**: curated PDFs filtered by athlete's sport, searchable, signed-URL viewer
- **Ask Gradus** (parent persona, Gemini): sport-scoped Q&A
- **Saved** answers (save/view/delete)

**Settings**

- Profile, Athletes (full management), Coaches, Appearance, Feedback, Sign out

---

## 🏃 Athlete

**Onboarding / Signup**

- **Parent-initiated**: enter 8-char parent invite code → confirm pre-filled identity (name, sports, linked coach) → choose **username** (3–24 chars, lowercase, real-time availability) + password
- **No email required** (synthetic email derived from username server-side); login accepts email-or-username; parent can reset password

**Plans & Goals** (`athlete.plans.*`)

- Tabs: Plans / Goals
- Plan detail with How / What toggle, Why expandable
- Plan session timer + flow-state feedback (5-point + note), wake-lock
- "Message coach about this plan"
- **Motivation card** on Goals tab (editable "What motivates you?", up to 500 chars)
- Editable long-term goal text

**Messages** — shared room (text, voice notes, plan tags, real-time, unread badge)

**Resources** (`athlete.resources.index.tsx`)

- **Safe Sport**: hotlines / independent external reporting links
- **Ask Gradus** (youth-athlete persona with safety guardrails)
- **Saved** answers

**Settings**

- Profile (name, birthdate), Username display, Appearance, Feedback, Sign out

---

## Cross-cutting

| Feature                                                  | Coach | Parent         | Athlete         |
| -------------------------------------------------------- | ----- | -------------- | --------------- |
| Light / Dark / Auto theme                                | ✅    | ✅             | ✅              |
| In-app feedback                                          | ✅    | ✅             | ✅              |
| Text + voice messages, plan tags, realtime, unread badge | ✅    | ✅             | ✅              |
| Ask Gradus AI                                            | —     | parent persona | athlete persona |
| Plan session timer + flow-state feedback                 | —     | ✅             | ✅              |
| PWA install banner                                       | ✅    | ✅             | ✅              |
| Login: email or username                                 | email | email          | username        |
| Beta signup gate                                         | ✅    | ✅             | parent-gated    |

---

## Notable sub-feature details

| Sub-feature                         | Details                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Invite codes (Coach → Parent)**   | Coach has a persistent 8-char code; parents enter it during signup or in settings to link their athlete                           |
| **Invite codes (Parent → Athlete)** | Parent gets a per-athlete 8-char code from Settings; athlete enters it to create their account                                    |
| **Invite codes (Parent → Coach)**   | Coach signup page accepts `?invite=CODE` in URL; coach can claim it post-signup                                                   |
| **Athlete username login**          | No email — synthetic email derived from username server-side; login page accepts "email or username"                              |
| **Parent resets athlete password**  | `resetAthletePassword` server fn callable from Parent Settings → athlete disclosure                                               |
| **Primary coach selection**         | Parent can designate one coach as primary per sport, from eligible linked coaches                                                 |
| **Voice capture (Coach Plans)**     | Hold-to-record mic FAB; ElevenLabs transcription; AI parses into structured plan/move edits; diff-highlights touched fields       |
| **AI Ask Gradus**                   | Per sport; parent persona vs. athlete persona system prompts; Gemini; answers saveable                                            |
| **Pre-lesson briefing**             | AI narrative per athlete per date; aggregates plan changes, cross-coach plans, practice logs, messages; content-hash cached       |
| **Lesson wrap-up prompts**          | Triggered post-lesson-slot end; coach chooses Edit / Redeploy / Dismiss; one prompt per athlete per day                           |
| **Session timer**                   | Parent and athlete have start/pause/resume/end with screen wake-lock; duration stored                                             |
| **Flow-state feedback**             | 5-point scale: Frustrated / Pushing / Steady / Locked In / Flowing + text note                                                    |
| **AI session summary**              | Coach and parent can request an AI narrative summary of all logged sessions for a plan                                            |
| **AI athlete summary**              | Coach's athlete detail sheet auto-generates a summary of last N days of practice + message signal                                 |
| **Theme**                           | 3-way toggle: Light / Dark / System (Auto) — all user types                                                                       |
| **PWA / install banner**            | Install-to-homescreen prompt shown as bottom banner when browser provides install event                                           |
| **Plan templates**                  | Coach can create plans with `kind: template`; templates have no athlete; cloneable into real plans                                |
| **Move library**                    | Coach-owned; moves have name, category, sport, description (what), cue (how), why, default target (reps/mins + value); searchable |
| **Schedule editor (Parent)**        | Day-of-week + time slot + frequency (weekly / biweekly / twice-monthly / monthly) + optional start date                           |
| **Week schedule (Coach)**           | Paginated by week; shows lesson slots per athlete per day; practice-summary heat from session flow states                         |
