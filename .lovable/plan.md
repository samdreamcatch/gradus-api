## Goal

Replace the three-stat row in the athlete detail sheet ("Practices / Minutes / Messages") with three coach-relevant **hour** counts, scoped to the same "Last 30 days" window already shown above the stats.

New stats:

1. **Practice hours — mine vs. total** — hours the athlete logged against plans I assigned vs. against any plan (mine or other coaches').
2. **Lesson hours — total** — all hours the athlete spent in lessons with any coach (load-balancing view, not just lessons with me).

Messages are dropped from this row.

```text
┌────────────────────────┬────────────────────────┐
│ 2.1 / 3.4              │ 1.8                    │
│ MY / TOTAL PRACTICE hrs│ TOTAL LESSON hrs       │
└────────────────────────┴────────────────────────┘
```

Display: 1 decimal place (e.g. `2.1`). The "mine vs. total" stat shows both numbers so the coach can see what share of practice is on their plans. Lesson hours is a single total across all coaches so the coach can gauge the athlete's overall lesson load.

## Files to change

### `src/lib/coach-athlete-detail.functions.ts`

- Extend `AthleteActivityCountsDTO`:
  - remove `sessions`, `practiceMinutes`, `messagesFromAthleteOrParent`
  - add `practiceMinutesMine`, `practiceMinutesTotal`, `lessonMinutesTotal`
- In `getCoachAthleteDetail.handler`:
  - Update the `plan_sessions` query to also bring back the plan's `coach_id` (join `plans!inner(coach_id)`), so we can split sessions by whether the plan belongs to this coach.
  - `practiceMinutesTotal` = sum of `duration_seconds` across all sessions in the 30-day window / 60.
  - `practiceMinutesMine` = same, restricted to sessions whose plan's `coach_id` equals the current coach.
  - Add a new query for `athlete_lesson_slots` where `athlete_id = X` (NO `coach_id` filter — we want all coaches). Compute `lessonMinutesTotal` by iterating the 30-day window, for each slot deciding whether it fires on that day per `frequency` / `weeks_of_month` / `starts_on`, subtracting `lesson_slot_overrides` with `status = 'canceled'`, then summing `(end_minute - start_minute)` over remaining occurrences. Reuse occurrence logic from `src/lib/coach-schedule.functions.ts` if present.
  - RLS note: `athlete_lesson_slots` SELECT policy for coaches scopes to slots whose `coach_id` matches the calling coach. To read all coaches' slots we must use `supabaseAdmin` (already used in this handler) — caller is already authorized via `assertCoachOwnsAthlete`.
  - Drop the messages query and the message-based contribution to `hasAnySignal`. Keep `hasAnySignal` based on practice sessions only (lessons are scheduled, not signal).
- Update the returned `activity` object accordingly.

### `src/components/coach/athlete-detail-sheet.tsx`

- Replace `ActivityCounts` (3-up `Practices / Minutes / Messages`) with a 2-up grid:
  - Tile 1: large `{mine.toFixed(1)} / {total.toFixed(1)}`, label `MY / TOTAL PRACTICE HRS`.
  - Tile 2: large `{lessons.toFixed(1)}`, label `TOTAL LESSON HRS`.
- Use `grid-cols-2` instead of `grid-cols-3`. Drop the messages tile and prop.
- Update the empty-state copy to: "No practice or lessons in the last {windowDays} days."

### AI summary path

Unchanged. `getCoachAthleteAiSummary` keeps using messages and per-session data as input — only the visible stat row changes.

## Technical notes

- Hours formatting: `(minutes / 60).toFixed(1)`.
- Window stays at `WINDOW_DAYS = 30` to match the existing "Last 30 days" section header.
- The lesson-hour math counts the slot's scheduled duration; rescheduled overrides keep the same duration unless `start_minute`/`end_minute` on the override differ — honor override times when present.
