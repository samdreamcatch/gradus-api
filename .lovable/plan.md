# Link generated plans back to the competition they came from

Yes, this is possible. Today a plan generated from competition results is only tagged as coming from "competition" — nothing records *which* competition. So the athlete page can't tell that a plan already exists for a given event, and always offers "Generate draft plan".

## What changes for the coach

On the athlete page, inside a competition's expanded card:

- No plan yet for that competition: "Generate draft plan" (unchanged).
- A plan already generated from that competition: "Go to plan" — opens the existing plan (draft or active) directly.
- If more than one plan came from the same competition, the newest one is opened, with the plan title shown on the row so it's clear which one.

The post-event card on the roster keeps its current behavior, but its "this athlete is done" check becomes exact instead of date-based.

## Technical notes

1. Migration: add `source_competition_id uuid` (nullable, references `public.competitions(id)` on delete set null) to `public.plans`, plus an index on `(athlete_id, source_competition_id)`. Backfill is not attempted — existing competition plans stay unlinked and simply show "Generate draft plan" until regenerated.
2. `generatePlanFromResults` in `src/lib/competition-results.functions.ts` sets `source_competition_id` on insert.
3. `getAthleteCompetitionResults` returns, per linked competition, `existingPlan: { id, title, status } | null` — newest plan for that athlete/coach with a matching `source_competition_id`.
4. `src/components/coach/competition-results-section.tsx` renders "Go to plan" (navigates to `/coach/plans/$planId`) when `existingPlan` is present, otherwise the current generate button. Shared Button primitives only, no new styles.
5. `getCoachPostEventItems` replaces the current "activated competition plan created after the event" heuristic with a direct `source_competition_id` match, so an athlete row clears exactly when a plan for that event exists and is active.
