# Simplify coach onboarding, default practice expectations

## Goal

Coach onboarding becomes two steps (name + sports, then review). Practice
expectations are pre-populated for every athlete from Gradus defaults, visible
with or without a coach. A coach can then tune the weekly expectation for a
specific athlete from their roster.

## What changes

### 1. Onboarding shrinks

Today the flow is: profile → levels → hours → invite → review (5 steps).
It becomes: profile (name + sports) → review (2 steps).

- Remove the "Which levels do you coach?" step.
- Remove the "Practice expectations" hours step.
- Remove the invite parents/athletes step. (Invite codes still exist in
  settings and the roster; a pending invite from a signup link still auto-claims
  on finish, so nothing breaks for coaches arriving through an invite.)
- Sport selection stays on the first step, with the same tier caps.

Because a coach's sport list is currently derived from their saved levels, on
finish we auto-save every level of each selected sport at the Gradus suggested
hours. Nothing downstream (roster sport filters, move-library seeding, goals
lookups) has to change, and the coach's settings editor opens pre-filled instead
of empty.

### 2. Defaults show without a coach

Practice expectations on the parent and athlete goal dashboards currently show
only when a primary coach has saved hours for that level; otherwise they are
blank. They will fall back, in order:

1. the coach's per-athlete override (new, below)
2. the primary coach's saved hours for that level
3. the Gradus default for that sport + level

So an athlete with no coach still sees a target at their current level and at
their season-goal level.

### 3. Per-athlete adjustment in the roster

In the athlete detail sheet (opened from the coach roster), each sport the coach
works on with that athlete gets an editable weekly practice expectation: one
number per sport, defaulting to the Gradus/level value, with a "reset to
default" affordance. Saving it overrides what the parent and athlete see for
that athlete only.

### 4. Coach settings keeps the level editor

"Sports & levels" in coach settings is unchanged — coaches who want to set their
own per-level defaults still can, it is just no longer part of signup.

## Technical notes

- `src/routes/_authenticated/coach.onboarding.tsx`: drop the `levels`, `hours`,
  and `invite` step kinds and their UI; `stepOrder` becomes
  `["profile", "review"]`. On finish, build level entries from the selected
  sports via `getSuggestedHours` in `src/lib/coach-sports.ts` and pass them to
  the existing `saveCoachLevels`. Custom sports get one default level row so the
  sport still registers. Remove now-unused custom-level state and helpers.
- New table `coach_athlete_practice_targets` (`coach_id`, `athlete_id`, `sport`,
  `hours_per_week`, unique on the triple) with GRANTs, RLS enabled, and policies
  scoped to the owning coach for write plus read access for that athlete's
  guardians/self-managed athlete, so the parent dashboard can read the override.
- New server fns in `src/lib/coach-athlete-detail.functions.ts` (or a sibling
  practice-targets module) to upsert and clear a target; wire into the roster
  detail sheet with a react-query mutation invalidating the roster/detail keys.
- Add a shared resolver used by `src/lib/parent-goals.functions.ts` and
  `src/lib/athlete-goals.functions.ts`: override → coach level hours → Gradus
  default. `hoursAtCurrent` / `hoursAtGoal` stop being nullable in practice, so
  the goal cards and practice ring always have a target.
- No change to `athlete_goals`, `coach_levels`, or coach settings.
