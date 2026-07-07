## Fix: Coach detail sheet says "hasn't set goals" when the athlete has goals for other sports

### What's happening
On David's view of Dani, the detail sheet filters `athlete_goals` down to the sports David coaches her in (golf). Dani has a goal, but only for tennis — a sport David doesn't coach her in. The sheet then shows the generic empty-state copy "Dani hasn't set goals yet", which is false and confusing.

Scope: coach-side UI copy only. No schema changes, no changes to under-18 flows, no changes to how goals are stored.

### Change
In `src/components/coach/athlete-detail-sheet.tsx`, when the goals array is empty:

- If the coach coaches at least one sport for this athlete (`coachedSports.length > 0`), show:
  > "{firstName} hasn't set goals for {sport list you coach} yet."
  (e.g. "Dani hasn't set goals for golf yet." — comma-joined for multiple.)
- Otherwise keep the current copy.

Also update the section heading — when the athlete is self-managed, keep "GOALS FROM ATHLETE"; when parent-managed, keep "GOALS FROM PARENT & ATHLETE". (Already correct — no change.)

### Supporting server change
`getCoachAthleteDetail` in `src/lib/coach-athlete-detail.functions.ts` already knows the coach's sports for this athlete via `getCoachAthleteSports`. Add a `coachedSports: { key: string; label: string }[]` field to `CoachAthleteDetailDTO` and populate it from that call (labels via `getSport`). The sheet reads it to build the empty-state sentence.

### Explicitly NOT in this change
- No change to the adult-athlete onboarding flow. The underlying sports/goals mismatch (Dani linked to David for golf but only has a tennis goal) is a separate product decision — happy to file a follow-up plan to either (a) require a goal per linked sport during onboarding, or (b) surface a "set a golf goal" prompt on the athlete side. Say the word and I'll spec it.
- No change to under-18 / parent-managed athletes' UI.
- No RLS / schema changes.
