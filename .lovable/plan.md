# Admin drill-downs: active users, plans, and session notes

Today the Reporting page mixes clickable stat cards (Total, New/7d, Active plans…) with dead-end plain metrics. "Active / 7d", "Active / 30d" and "Sessions / 7d" are not clickable, and the Plans list links to the coach's user page rather than the plan itself — so there is no way to open a plan or read session notes from admin.

## What changes

**1. Active users become clickable**
- "Active / 7d" and "Active / 30d" on each tab (Coaches, Parents, Athletes) become links to a new list showing exactly who was active in that window, for that role.
- Each row: name, email/parent, role, last activity date, and what the activity was (message, session logged, wrap-up, plan created, resource uploaded). Rows link to the existing user detail page.
- The daily-active-users chart gets the same treatment: clicking a day in the chart opens the active-user list for that single day.

**2. Plans are openable**
- Plan rows in the Plans list link to a new admin plan detail page instead of the coach's profile.
- Plan detail shows: title, status, kind, coach, athlete, created/updated dates, notes, the ordered move list (name, cue, why, target), and the share state.
- "Active plans" cards already link to the filtered plans list, so no change there.

**3. Session logs with notes**
- Plan detail includes a "Sessions" section: every logged session for that plan — date, who logged it (parent / athlete), duration, mood state, and the full note text.
- "Sessions / 7d" on the Athletes tab becomes a link to a new sessions list: recent sessions across all athletes with athlete, plan title, mood, duration, date, and note preview; each row opens the plan detail.

Test-user filtering (the `test` toggle) applies to all three new views, same as existing lists.

## Technical notes

- New server functions in `src/lib/admin.functions.ts`, all admin-gated via `assertAdmin` + `supabaseAdmin`:
  - `getAdminActiveUsers({ windowDays | date, role, includeTest })` — reuses the same activity-signal queries as `getDailyActiveUsers` (messages, plan_sessions, lesson_wrap_ups, plans, resources), but returns per-user rows resolved to coach/parent/athlete profiles instead of daily counts. Extract the signal-gathering into a shared helper so counts and lists can't drift.
  - `getAdminPlanDetail({ planId })` — plan + coach_profiles + athletes + plan_moves (ordered by position) + plan_sessions.
  - `getAdminSessions({ days, includeTest })` — recent plan_sessions joined to plans/athletes.
- New routes:
  - `src/routes/_authenticated/admin.active.tsx` (search params: `role`, `days` or `date`, `test`)
  - `src/routes/_authenticated/admin.sessions.tsx` (search params: `days`, `test`)
  - `src/routes/_authenticated/admin.plans.$planId.tsx`
- `src/routes/_authenticated/admin.reporting.tsx`: convert the three `Metric` usages to `Stat`-style links; add an `onClick` handler on the chart area for day drill-down.
- `src/routes/_authenticated/admin.list.$kind.tsx`: for `kind === "plans"`, link rows to `/admin/plans/$planId`.
- Mood state indexes map through the same `STATE_LABELS` ordering used in `src/lib/plan-sessions.functions.ts` — import/share that constant rather than re-declaring it.
- UI uses existing components only: `Eyebrow`, `Chip`/`chipClasses`, `Tag`, card/divider tokens, matching the current list page layout.
