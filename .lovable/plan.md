## What changes

Coach roster `practice this week` currently only counts sessions logged against **this coach's own active plan** for the athlete. Switch it to count **all of the athlete's `plan_sessions` in the rolling 7-day window**, regardless of plan or coach.

Denominators stay where they already are:
- **Coach roster** → this coach's `coach_levels.practice_hours_per_week` for the athlete's season-goal sport (unchanged).
- **Athlete dashboard** and **Parent goals dashboard** → primary coach's level setting per sport (already implemented this way in `athlete-goals.functions.ts` and `parent-goals.functions.ts`; no changes needed).

## File touched

`src/lib/coach-schedule.functions.ts` — `getRosterPracticeSummaries`

### Specifics

1. Drop the `plans` lookup as the gate for which sessions to count. We still need this coach's active plan map only if it's used elsewhere — it isn't (it's only used to build `planIds`). Remove the `plansRes` query and `planByAthlete` map.
2. Replace the `plan_sessions … .in("plan_id", planIds)` query with `plan_sessions … .in("athlete_id", athleteIds)` over the same 7-day window. Continue to select `athlete_id, duration_seconds, state_index, logged_at` and order newest-first.
3. Keep `coach_levels` lookup, `coach_athlete_sports` scoping, and `athlete_goals → expectedByKey` exactly as they are so the `/ Xh goal` denominator continues to use this coach's setting for the athlete's season-goal sport.
4. Result shape (`AthletePracticeSummary`) is unchanged. The `windowDays: 7` and label "practice this week" stay.

### Side effects

- Athletes who only log practice on another coach's plan will now show non-zero hours and recent state dots in this coach's roster — intended.
- Mood-dot strip (`sessionStates`) will now reflect all recent practice, which matches the new "all practice" semantics.
- No DB migration, no RLS change — `supabaseAdmin` already bypasses RLS for this server function.
- Existing cache invalidations on `["coach", "roster", "practice-summaries"]` keep working.

## Out of scope

- No change to athlete or parent dashboards.
- No change to the 7-day window length or the "/ Xh goal" label.
- No change to lesson-wrap-up flow or plan activation rules.
