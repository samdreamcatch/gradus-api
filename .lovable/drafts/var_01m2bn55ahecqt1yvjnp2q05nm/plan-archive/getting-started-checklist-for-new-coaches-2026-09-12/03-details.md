## How progress is detected

Progress is read from what the coach has actually done — no extra tracking
table, and it stays correct even if they do a step from somewhere else in the app:

- Schedule: the coach has at least one lesson slot.
- Invites: at least one athlete on their roster has been invited or already has
  a parent/athlete account attached.
- Plan: the coach has created at least one practice plan.

## Lesson times entered by a parent or athlete

When a parent or adult athlete has already entered their lesson times with this
coach, those lessons are stored against the coach and the coach's schedule
already reads every lesson attached to them, whoever entered it — so they show
up as soon as the connection exists, including connections made later.

The checklist uses that same signal, so a coach who joins through an existing
parent or athlete sees step 1 already ticked off, with a short line in the card
saying the schedule came from their connected families and can be edited.
The card re-checks on each roster visit, so a later connection ticks it too.

## Technical notes

- New server function `getCoachOnboardingChecklist` in
  `src/lib/coach-checklist.functions.ts` (auth middleware), one count query per
  signal against `athlete_lesson_slots` (filtered by `coach_id`, which already
  covers parent- and athlete-entered slots), `athletes`/`coach_athletes`, and
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
- Query invalidated after import/invite/plan mutations, and refetched on roster
  mount, so a step ticks over without a manual refresh.
- The existing one-off "Create your first plan" banner on the roster is removed,
  since the checklist covers it.
