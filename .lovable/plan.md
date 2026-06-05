# Parent Goals Dashboard

A new "Goals" view on `/parent/plans` (or a sibling `/parent/goals` tab — see Open question 1) that mirrors the coach's on-track / behind / over-target language and reuses existing design tokens. No schema changes; all data already exists.

## Layout (per selected athlete)

```text
┌─────────────────────────────────────────────┐
│  [Athlete switcher: Avery ▾]   sport pill   │
├─────────────────────────────────────────────┤
│  WORKING TOWARD                             │
│  Pre-Preliminary                            │
│  Currently: Basic Skills → goal 1 level up  │
│                                             │
│  ──•──○──○──○──○──                          │
│  Basic   Pre-Pre  Prelim  Pre-Juv           │
│  (one tick below current → one above goal)  │
├─────────────────────────────────────────────┤
│  THIS WEEK'S PRACTICE                       │
│   ╭─────╮                                   │
│   │ 2.1 │   Target band: 1–3 hr/wk          │
│   │hr/wk│   Status: On track                │
│   ╰─────╯   (4-wk trailing avg)             │
├─────────────────────────────────────────────┤
│  LONG-TERM GOAL                             │
│  "Compete at regional juvenile level by     │
│   end of next season."                      │
└─────────────────────────────────────────────┘
```

Renders one block per sport the athlete has goals in. Athlete switcher at the top (parent-only for now; athlete-side view deferred per your earlier answer).

## What each block reads

- **Working toward** — `athlete_goals.current_level_key` and `season_goal_key`. Levels-away is computed against the static ladder in `src/lib/coach-sports.ts`.
- **Intensity slider** — dots = the slice of the ladder from one level below `current_level_key` to one level above `season_goal_key`. Labels are the real level display names (e.g. "Basic Skills", "Pre-Preliminary"). Filled dot = current level. No interaction — display only.
- **Target band (hr/wk)** — `coach_levels.practice_hours_per_week` for the primary coach (from `athlete_primary_coaches` by sport), pulled at both `current_level_key` and `season_goal_key`. Lower bound = min of the two, upper = max. Falls back to "Not yet set" if the coach hasn't filled in either level.
- **Logged hours** — trailing 4-week avg from `plan_sessions.duration_seconds` filtered to `athlete_id` + `logged_at >= now() - interval '28 days'`, shown as hr/wk.
- **Status pill** — `Building up` if logged = 0 OR (logged < lower AND athlete < 4 wks since first session); `Behind` if logged < lower band; `On track` if within band; `Over target` if logged > upper band.
- **Long-term goal** — `athlete_goals.long_term_goal` free text (existing).

## Components to build

`src/components/parent/goals/` —
- `goals-dashboard.tsx` — top-level, owns athlete switcher state, renders one `<SportGoalCard>` per goal row.
- `sport-goal-card.tsx` — the layout above; composes the three sections below.
- `working-toward-section.tsx` — current → goal + intensity slider.
- `intensity-ladder.tsx` — pure presentational dot strip. No Radix Slider (it's not interactive); just a row of dots + labels with the active one filled using `--accent`.
- `practice-tracking-section.tsx` — number + target band + status pill. Uses a simple ring (SVG, no new dep) colored against the band; uses `--accent` for on-track, `--pen-pool` for building-up, `--attention` for behind, `--destructive` for over-target.
- `status-pill.tsx` — wraps `<Badge>` with the status→token mapping above.

All tokens come from `src/styles.css`. No new color tokens.

## Data layer

New `src/lib/parent-goals.functions.ts` with one server fn:

- `getParentGoalsDashboard()` — middleware `requireSupabaseAuth`. Returns, for the signed-in parent's athletes:
  ```ts
  Array<{
    athleteId, athleteName,
    sports: Array<{
      sport, currentLevelKey, seasonGoalKey, longTermGoal,
      primaryCoachId | null,
      targetBand: { lower: number, upper: number } | null,
      loggedHoursPerWeek: number,
      sessionsCount: number,
      firstSessionAt: string | null,
    }>
  }>
  ```
  Implementation: read `athletes WHERE parent_id`, then in parallel for each athlete join `athlete_goals`, `athlete_primary_coaches`, `coach_levels` (for the two level keys), and aggregate `plan_sessions` (sum duration / count / min logged_at) over the 28-day window.

Status + levels-away + slider window are derived **client-side** from the static ladder in `coach-sports.ts` so the server fn stays a thin DTO.

Route wiring: existing `/parent/plans` already has a Plans/Goals split — replace the placeholder Goals view with `<GoalsDashboard />`, primed via `ensureQueryData` on the route loader (already under `_authenticated/`).

## Open questions

1. **Tab vs route** — keep Goals as a tab on `/parent/plans` (matches the FilterBar work we just shipped) or split into its own `/parent/goals` route? Defaulting to **tab on /parent/plans** unless you say otherwise.
2. **Target band formula** — I'm using `[hours_for(current_level), hours_for(season_goal)]`. Alternative is a ±20% band around the current level only. Easy to swap.
3. **"Building up" trigger** — proposing "0 sessions logged in last 28 days OR first session was <28 days ago and they're under lower bound." Sound right?

## Technical notes

- New server fn → no migration, no GRANTs, no new RLS. All reads ride existing policies (parent → athletes → goals/sessions; primary coach lookup uses the parent-readable `athlete_primary_coaches`; `coach_levels` is currently coach-only, so the server fn loads it through `supabaseAdmin` with explicit `(coach_id, sport, level_key)` filters — safe because the parent is only granted the two numeric hour values for their own athlete's primary coach, no other coach data leaks).
- Ring is hand-rolled SVG (one `<circle>` background + one `<circle>` stroke-dasharray foreground); no chart library.
- Route loader uses the canonical `queryOptions` + `ensureQueryData` + `useSuspenseQuery` pattern. errorComponent/notFoundComponent already exist on the parent route.
