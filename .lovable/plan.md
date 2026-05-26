# Plan: extend parent onboarding with goals, schedule, and athlete QR invite

## Flow after changes

```
/signup/parent              (account + invite code) — unchanged
   ↓
/signup/parent/athletes     (add athletes)          — unchanged form, "Continue" instead of "Finish"
   ↓
/signup/parent/goals        NEW — loops per athlete: sport (if needed), current level, season goal, long-term goal
   ↓
/signup/parent/schedule     NEW — loops per athlete: list of {day, start, end} slots
   ↓
/parent                     stub page + QR invite card
```

The athletes step will switch from final-submit to "Save & continue", redirecting to `/signup/parent/goals?code=…`. The goals & schedule routes load the parent's athletes (scoped to the invite code's coach) and step through them one at a time using local state.

## Database (one migration)

New tables, all RLS-scoped to the owning parent + the linked coach:

- `athlete_goals` — `id`, `athlete_id`, `coach_id`, `sport` (text, references coach_levels.sport), `current_level_key` (text), `season_goal_key` (text), `long_term_goal` (text, max 2000), timestamps. Unique on `(athlete_id, coach_id, sport)`.
- `athlete_lesson_slots` — `id`, `athlete_id`, `coach_id`, `day_of_week` (smallint 0–6, Sun=0), `start_minute` (smallint 0–1439), `end_minute` (smallint 0–1439, > start), timestamps. Index on `(athlete_id, coach_id)`.
- `athlete_invite_codes` — `id`, `parent_id`, `athlete_id`, `code` (text, unique, 8-char `A–Z2–9` like coach codes), `used_at` (timestamp, nullable), timestamps.

Times stored as integer minutes-from-midnight so we don't fight Postgres `time` serialization; UI converts to/from 12-hour display.

RLS:
- Parents CRUD rows where parent owns the athlete (via `parent_profiles → athletes`).
- Coaches SELECT rows for athletes on their roster (via `coach_athletes`).
- `athlete_invite_codes`: parent-owned CRUD; public lookup-by-code happens through an admin server fn (no broad anon SELECT policy).

GRANTs: `SELECT, INSERT, UPDATE, DELETE` to `authenticated`; `ALL` to `service_role`. No anon.

## Server functions (`src/lib/parent-signup.functions.ts`)

Add:
- `listAthletesForCode({ code })` — returns athletes for the signed-in parent linked to the coach behind `code`, plus the coach's sports + sport catalog metadata (levels list).
- `saveAthleteGoals({ code, athleteId, sport, currentLevelKey, seasonGoalKey, longTermGoal })` — upserts on `(athlete_id, coach_id, sport)`. Validates that `currentLevelKey` and `seasonGoalKey` exist in the catalog for `sport`, `longTermGoal` ≤ 2000 chars.
- `saveAthleteSchedule({ code, athleteId, slots: [{ dayOfWeek, startMinute, endMinute }] })` — replaces all slots for `(athlete_id, coach_id)`. Validates 0–6 / 0–1439 / end > start, max 20 slots.
- `getOrCreateAthleteInviteCode({ athleteId })` — returns existing or generates new 8-char code (same alphabet as coach codes); returns the public invite URL (`<origin>/signup/athlete?code=…`) for QR encoding.
- `listAthletesWithInviteCodes()` — for /parent page, returns parent's athletes + their codes/URLs.

All protected with `requireSupabaseAuth`; coach-side reads use the existing middleware client; admin elevation only where strictly needed (code generation collision retry).

## Routes

### `src/routes/signup.parent.athletes.tsx` (edit)
- Change submit handler to `navigate({ to: "/signup/parent/goals", search: { code } })` instead of `/parent`.
- Button text "Continue" instead of "Finish".

### `src/routes/signup.parent.goals.tsx` (new)
- `validateSearch`: same `{ code }` schema as athletes route.
- Loader prefetches `listAthletesForCode`.
- Component state: `index` (which athlete), plus per-athlete `{ sport, currentLevelKey, seasonGoalKey, longTermGoal }`.
- For each athlete:
  - If coach has 1 sport → auto-set sport, skip picker.
  - If multiple → `Select` of coach's sports.
  - `Select` for current level (from `SPORTS` catalog for the chosen sport).
  - `Select` for season goal (same level list; client-side hint "must be at or above current level" — soft validation only).
  - `Textarea` for long-term goal (max 2000, optional).
- "Save & next" calls `saveAthleteGoals` then advances; on last athlete → navigate to `/signup/parent/schedule?code=…`.
- Progress chip: `Athlete X of N`.

### `src/routes/signup.parent.schedule.tsx` (new)
- Same loader/structure as goals route.
- For each athlete: list of slot rows with `Select` day (Sun–Sat), `Select` start time, `Select` end time. Time options are 15-min increments rendered in 12-hour format (`6:00 AM` … `9:45 PM`), stored as minutes. "+ Add another time" / per-row remove.
- At least one valid slot required (parent can also leave empty and use a "Skip — no fixed schedule" link if they don't know it).
- Last athlete → `saveAthleteSchedule` then navigate to `/parent`.

### `src/routes/_authenticated/parent.tsx` (edit)
- Keep header + sign-out.
- Fetch `listAthletesWithInviteCodes` via `useSuspenseQuery`.
- For each athlete, render a card with name + a QR code (using `qrcode.react`) of the athlete's invite URL, plus the 8-char code as fallback text and a copy button.
- Caption: "Optional — only needed if your athlete has their own phone."

### `src/routes/signup.athlete.tsx` (new, minimal stub)
- `validateSearch` for `?code`.
- Renders "Athlete signup coming soon — your parent has invited you." plus the code, so QR scans land somewhere real and don't 404. Real athlete auth flow is out of scope for this PR.

## Design system usage

All new screens reuse the existing onboarding card chrome (`rounded-2xl bg-card p-8 shadow-card`, accent-ink step labels, Fraunces headings, Caveat for soft hints like "hrs / week" already used in coach onboarding). Time/day pickers use shadcn `Select`. Schedule rows use the same `border border-divider bg-elevated` row pattern as coach onboarding's hours step. QR card uses `bg-elevated`, divider border, and `font-mono tracking-[0.25em]` for the 8-char code (matches the existing invite-code styling).

## Dependency

Add `qrcode.react` for the QR component (pure JS, Worker-safe).

## Out of scope

- Real athlete signup UI / auth (stub page only).
- Editing goals/schedule after onboarding (will live in a parent settings page later).
- Calendar-based scheduling / timezone handling (slots are weekly, parent's local 12-hour entry).
