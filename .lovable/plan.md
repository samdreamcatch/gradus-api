# Adult athlete lesson schedule

Adult (self-managed) athletes can already link one or more coaches, but there's no way for them to record when their lessons happen. Parents do this today via `ScheduleEditor` writing to `athlete_lesson_slots` scoped by `(athlete_id, coach_id)`. We'll give adult athletes the same capability, in both onboarding and settings, reusing the existing editor and slot table.

## What we'll build

**1. Reusable server functions** (new `src/lib/adult-athlete-schedule.functions.ts`)
- `getAdultAthleteSchedules` — returns the signed-in adult athlete's linked coaches, each with their current slots (day, start/end, frequency, weeks-of-month, starts-on).
- `saveAdultAthleteScheduleForCoach({ coachId, slots })` — verifies the caller is a self-managed athlete linked to that coach, then replaces the slot rows for `(athlete_id, coach_id)` — same delete-then-insert pattern parent uses.

**2. Onboarding — new "Schedule" step** (`src/routes/_authenticated/athlete.onboarding.tsx`)
- Flow becomes: Coach → Goals → **Schedule** → done.
- Only shown if the athlete linked at least one coach in step 1 (skipped otherwise, same as goals).
- One page per linked coach with the shared `ScheduleEditor`; "Skip for now" and "Save & next / Finish" match the parent signup schedule step.

**3. Settings — schedule editor per coach** (`src/routes/_authenticated/athlete.settings.tsx`, `AdultCoachesSection`)
- Under each linked coach row (alongside "Edit sports" / "Unlink"), add a "Schedule" disclosure that opens the shared `ScheduleEditor` prefilled with saved slots and saves via `saveAdultAthleteScheduleForCoach`.
- Uses the same visual pattern as parent settings' `CoachScheduleEditor` — no new component, just wire the existing one in.

## Not doing
- No schema change — `athlete_lesson_slots` already supports this shape.
- No changes to parent flows or coach-side roster views (they already read from the same table).
- No new UI for coach-less schedule entry (adult athletes without a linked coach have nowhere to schedule against; the step is skipped, matching current parent behaviour).

## Technical notes
- Both new server fns use `requireSupabaseAuth` and load `supabaseAdmin` inside the handler; they resolve `athletes.id` via `user_id = context.userId` and enforce `self_managed = true` plus a `coach_athletes` link before writing.
- The editor's `Slot` shape maps 1:1 to the parent `saveAthleteSchedule` payload — we reuse `validateSlots`, `toISODate`, and `emptySlot` from `src/components/parent/schedule-editor.tsx`.
- Onboarding after Goals: fetch linked coaches via existing `listAdultAthleteCoaches`; if empty, navigate straight to `/athlete/plans`.
- Settings uses `useQuery(["adult-athlete-schedules"])` and invalidates it (plus `["adult-athlete-coaches"]`) after save.
