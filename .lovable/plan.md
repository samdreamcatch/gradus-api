# Co-guardian parity with the primary parent

A second guardian on a Family plan can see an athlete, but several parts of the app still
recognize only the athlete's *primary* parent. That's why messaging a coach from a plan
failed with "Not authorized to open this conversation."

## What's already fixed this session

- Athlete profiles are now visible to linked co-guardians (access rule added), so shared
  athletes appear in lists and plan filters.
- The messaging code path that opens a coach conversation now accepts co-guardians, and the
  "who can I message" list is built from all athletes a guardian is linked to.

## What still needs to change

Confirmed by inspecting the current access rules, these areas still check only
`athletes.parent_id`, so a co-guardian is silently blocked or sees nothing:

1. **Practice log / sessions** — a co-guardian cannot see logged sessions for a shared
   athlete (the view rule checks the primary parent only). Logging is already guardian-aware
   on insert, so a co-guardian could write a row they then can't read.
2. **Goals** — viewing and removing an athlete's goals is limited to the primary parent.
3. **Lesson schedule** — viewing, adding, editing, and removing lesson slots (and per-date
   overrides) is limited to the primary parent.
4. **Parent settings** — the athlete list is guardian-aware, but a step inside it skips any
   athlete where the caller isn't the primary parent, so co-guardians can lose coach-invite
   context for shared athletes.

## Approach

Reuse the guardian-aware helpers that already exist in the database rather than writing new
per-table logic:

- Read access switches to the existing "is a parent or guardian of this athlete" helper.
- Write access switches to the existing "can write for this athlete" helper, which already
  encodes the rule that co-guardians write only while the Family plan is active and
  otherwise stay read-only.

Then a pass over the parent-facing server code to remove leftover primary-parent-only
filters (parent settings), so the UI shows the same athletes and controls to both guardians.

## Technical details

- Migration replacing the parent policies on `plan_sessions` (select/delete),
  `athlete_goals` (select/delete/update/insert), `athlete_lesson_slots` (all commands), and
  `lesson_slot_overrides` with versions built on `public.is_parent_of_athlete(...)` for reads
  and `public.parent_can_write(...)` for writes. Existing coach/athlete policies untouched.
- `athlete_invite_codes` stays scoped to the row's own `parent_id` (each guardian generates
  their own code) — no change.
- `src/lib/parent-settings.functions.ts`: drop the `parent_id !== parent.id` skip so shared
  athletes render for co-guardians; keep primary-only gating on guardian invite/removal
  controls, which is intentional.
- Verification: query the shared athlete (Jamie Gilmore) as the co-guardian's role context to
  confirm sessions, goals, and slots come back, then re-test sending a plan message.
