## How progress is detected

Progress is read from what the coach has actually done — no extra tracking
table, and it stays correct even if they do a step from somewhere else in the app:

- Schedule: the coach has at least one lesson slot.
- Invites: at least one athlete on their roster has been invited or already has
  a parent/athlete account attached.
- Plan: the coach has created at least one practice plan.

## Technical notes

- New server function `getCoachOnboardingChecklist` in
  `src/lib/coach-checklist.functions.ts` (auth middleware), one count query per
  signal against `athlete_lesson_slots`, `athletes`/`coach_athletes`, and
  `plans`. No schema change.
- New component `src/components/coach/getting-started-checklist.tsx`, rendered
  from `src/routes/_authenticated/coach.roster.tsx`. It reuses Card, Button,
  Eyebrow, Tag, and the bottom `Sheet` (with `paper-surface`); the check marks
  use `lucide-react` `Check` / `Circle` in accent and secondary ink. No new
  primitives, no hover states — `press` / `press-soft` only.
- Auto-open on first roster visit after onboarding, tracked in `localStorage`
  per coach id (`gradus.coachChecklist.<id>`), alongside the dismissed flag.
  Collapsed card afterwards; hidden entirely once all three are complete or
  the coach dismisses it with the top-right ×.
- Step actions reuse what already exists: the schedule import sheet, the invite
  hub sheet, and navigation to the plan builder.
- Query invalidated after import/invite/plan mutations so a step ticks over
  without a refresh.
