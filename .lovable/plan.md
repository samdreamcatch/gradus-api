## Goal model: per athlete + sport, scaled to the primary coach

Goals are owned by `(athlete, sport)`. Every coach linked to the athlete for that sport can read the goal. The "primary coach" decides the **frame of reference** — the level scale, naming conventions, and practice expectations the goal is expressed in. Schedule remains per coach (lesson times differ per coach).

### Database changes (one migration)

1. **New table `athlete_primary_coaches`**
   - Columns: `athlete_id`, `sport`, `coach_id`, timestamps.
   - Unique: `(athlete_id, sport)`.
   - FKs: athlete → `athletes`, coach → `coach_profiles`.
   - RLS: parent of athlete can select/insert/update/delete; any coach linked to the athlete can select.
   - Trigger: on insert/update, assert the coach is in `coach_athletes` for that athlete AND offers `sport` in `coach_levels`.

2. **`athlete_goals` reshape**
   - Drop existing unique `(athlete_id, coach_id, sport)`; add unique `(athlete_id, sport)`.
   - Keep `coach_id` column, now interpreted as "primary coach at time of last write" (advisory; server stamps it from `athlete_primary_coaches` on every upsert).
   - Backfill: collapse duplicates per `(athlete_id, sport)` keeping the most recently updated row.
   - RLS: parent owns; **any coach linked to the athlete via `coach_athletes` can read** goal rows for that athlete (so non-primary coaches see the goal too).

3. **Backfill `athlete_primary_coaches`**
   - For every `(athlete, sport)` that has either an `athlete_goals` row or a coach linked via `coach_athletes` + `coach_levels`, insert a primary row picking the earliest-linked eligible coach. Idempotent.

4. **`athlete_lesson_slots`** — unchanged. Still keyed by `(athlete_id, coach_id, ...)`.

### Server function changes (`src/lib/parent-settings.functions.ts`)

Helper rewrite:
- `getParentProfile(userId)` — parent row only, no coach assertion.
- `getAthleteCoaches(athleteId)` — `[{ coachId, coachName, sports: string[] }]` from `coach_athletes` joined to `coach_profiles` + `coach_levels`.
- `getPrimaryCoach(athleteId, sport)` — reads `athlete_primary_coaches`, returns null if unset.
- `ensurePrimaryCoach(athleteId, sport)` — if no primary exists, picks the earliest eligible coach and inserts; returns the resolved coachId or null when no coach teaches that sport.

Function rewrites:

- **`getParentSettings`** — new per-athlete shape:
  ```
  athletes: [{
    id, firstName, lastName, birthdate, inviteCode,
    coaches: [{ coachId, coachName, sports: string[] }],
    sports: [{
      sport,
      primaryCoachId: string | null,
      primaryCoachName: string | null,
      eligibleCoaches: [{ coachId, coachName }],  // coaches who teach this sport
      goals: { currentLevelKey, seasonGoalKey, longTermGoal } | null
    }],
    schedulesByCoach: [{ coachId, coachName, slots: [...] }]
  }]
  ```
  Drop top-level `coachId` / `coachSports`. `sports` is the union of sports across the athlete's coaches' `coach_levels`. Level scale shown in the UI comes from the primary coach's sport entry.

- **`updateAthleteGoals`** — input: `{ athleteId, sport, currentLevelKey, seasonGoalKey, longTermGoal }`. Server:
  1. `assertOwnsAthlete`.
  2. Verify `sport` is offered by at least one of the athlete's coaches.
  3. `ensurePrimaryCoach(athleteId, sport)` → resolve primary.
  4. Upsert `athlete_goals` on `(athlete_id, sport)` stamping `coach_id` with the resolved primary.

- **`setPrimaryCoach`** — new fn `{ athleteId, sport, coachId }`. Asserts ownership and that the coach teaches that sport for the athlete. Updates `athlete_primary_coaches`; if a goal row exists, re-stamps its `coach_id` to the new primary (level keys are intentionally left untouched — the parent will be prompted to re-confirm; see UI below).

- **`replaceAthleteSchedule`** — input: `{ athleteId, coachId, slots }`. Server asserts the coach is linked to the athlete. Per-coach delete + insert. (Unchanged behavior, just an explicit per-coach scope.)

- **`addAthlete`** — drop the "must have coach" gate. Insert athlete + invite code. New athlete with no coach simply has goals/schedule gated in the UI until a coach links.

- **`removeAthlete`** — use `getParentProfile`; also delete the athlete's `athlete_primary_coaches` rows.

### UI changes (`src/routes/_authenticated/parent.settings.tsx` + `src/components/parent/*`)

- **AthletesList** — drop top-level `coachSports`. For each athlete: render one `GoalsSubrow` per sport in `athlete.sports`, and one `ScheduleSubrow` per coach in `athlete.schedulesByCoach` (or a single editor with a coach selector when there's more than one).

- **`GoalsSubrow`** (per sport)
  - Header: sport name + "Primary coach: <name>". When `eligibleCoaches.length > 1`, the name is a small select; changing it calls `setPrimaryCoach`, refetches, and shows a one-line note: "Levels now use <new coach>'s scale — please confirm." Existing level keys are preserved but the form will visually re-render against the new scale (if a saved key doesn't exist in the new scale, the field shows as empty and prompts re-selection).
  - Body: `AthleteGoalsForm` scoped to the row's sport — the in-form sport selector is hidden; the level scale is the **primary coach's** scale for that sport (fallback to the global `SPORTS` catalog if the coach hasn't customized).
  - Empty state when `athlete.coaches.length === 0`: "Link a coach first to set goals."

- **`ScheduleSubrow`** (per coach)
  - When multiple coaches, a "Coach" select scopes the form; saving calls `replaceAthleteSchedule` with that `coachId`.
  - Empty state when no coaches: "Link a coach first to set a schedule."

- **Add-athlete UX** — unchanged form; the new athlete card just shows "No coach yet — share invite code <X>" until claimed.

### Coach-facing impact (read paths only)

Any coach UI that currently reads `athlete_goals` filtered by `coach_id` should switch to filtering by `athlete_id` + `sport` (no coach_id filter), so non-primary coaches see the same goal record. Level labels are rendered using the **primary coach's** scale for that sport. This plan only touches the read shape, no editor changes on coach pages.

### Multi-scenario validation

- 1 sport, 7 coaches → 1 goal row (any of the 7 can read it; primary scales it); 7 schedule editors.
- 2 sports, 5 coaches with overlap → 2 goal rows, each with its own primary selector.
- Two siblings, same coach + sport → 2 separate goal rows, one per child.
- New child with no coach → name/birthdate/invite work; goals/schedule gated.

### Out of scope

- Coach-side editors for goals.
- Invite / coach-linking flow.
- Notifications when primary changes.
