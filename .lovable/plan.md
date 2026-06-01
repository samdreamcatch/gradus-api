## Goal

Give the signed-in athlete a Plans list and plan-detail experience that mirrors `/parent/plans`, including starting a session, ending it, and submitting flow-state feedback to the coach — attributed to the athlete (not the parent).

## 1. Database migration

Loosen `plan_sessions` so athletes can insert their own sessions.

```sql
ALTER TABLE public.plan_sessions ALTER COLUMN parent_id DROP NOT NULL;

CREATE POLICY "Athletes insert sessions for own plans"
ON public.plan_sessions FOR INSERT TO authenticated
WITH CHECK (
  parent_id IS NULL
  AND EXISTS (SELECT 1 FROM athletes a WHERE a.id = plan_sessions.athlete_id AND a.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM plans p WHERE p.id = plan_sessions.plan_id AND p.athlete_id = plan_sessions.athlete_id)
);

CREATE POLICY "Athletes view sessions for own plans"
ON public.plan_sessions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM athletes a WHERE a.id = plan_sessions.athlete_id AND a.user_id = auth.uid()));
```

Existing parent policies remain. Athlete-logged rows are distinguishable by `parent_id IS NULL` (useful later for a "logged by" badge — not surfaced yet).

## 2. New server fns — `src/lib/athlete-plans.functions.ts`

Mirror `parent-plans.functions.ts`, scoped to the signed-in athlete via `athletes.user_id = auth.uid()`. Returns the same DTO shape plus a derived `sport` per plan.

- `listAthletePlans` → `{ athlete: { id, firstName }, plans: AthletePlanSummaryDTO[] }`
  - Looks up the athlete row by `user_id`.
  - Loads plans where `athlete_id = athlete.id`, `kind = 'plan'`, status in (`active`,`benched`).
  - Computes `sport` per plan from `athlete_goals` matched by `(athlete_id, coach_id)`. Fallback: first `plan_moves.move_id → moves.sport`. Final fallback: `""`.
  - Reuses `loadSessionsByPlanIds` (RLS-safe under new athlete SELECT policy).
- `getAthletePlan({ id })` → same shape as `getParentPlan` (plan detail + moves), with an ownership check on `athlete.user_id = auth.uid()`.

## 3. New server fn — `submitAthletePlanSession` (add to `src/lib/plan-sessions.functions.ts`)

- Input: `{ planId, stateIndex, note, durationSeconds }`.
- Resolves the athlete via `athletes.user_id = auth.uid()`, verifies the plan belongs to that athlete, inserts with `parent_id = null` and `athlete_id = athlete.id`.
- Invalidations in callers: `["athlete-plans"]`, `["athlete-plan", planId]`, `["plan-sessions", planId]`, plus parent/coach keys so the coach's view updates live.

## 4. New component — `src/components/athlete/bottom-nav.tsx`

`AthleteBottomNav` mirroring `ParentBottomNav`:
- Dashboard → `/athlete`
- Plans → `/athlete/plans` (matchPrefix `/athlete/plans`)
- Messages / Resources stubbed via `toast`, same icons.

## 5. New route — `src/routes/_authenticated/athlete.plans.index.tsx`

Visual clone of `parent.plans.index.tsx`:
- Fraunces "Plans" eyebrow with Tennis pen highlight.
- Subtitle: `Your plans` (handwritten, only when plans exist).
- Three pill filters: **Status / Coach / Sport** (Status defaults to Active; Coach and Sport default to "All", disabled when only one option).
- Sport options derived from `plans.map(p => p.sport)` (de-duped, sorted; rows with empty sport are bucketed under "Other" only if any exist).
- `PlanCard` reused — subtitle is `Coach {coachName}` (no athlete name; athlete only has themselves). Links to `/athlete/plans/$planId`.
- Empty state copy: "No active plans yet — your coach will share one here." / "No benched plans."
- `AthleteBottomNav` at the bottom.

## 6. New route — `src/routes/_authenticated/athlete.plans.$planId.tsx`

Clone of `parent.plans.$planId.tsx` with these substitutions:
- Imports `getAthletePlan` and `submitAthletePlanSession`.
- Back link → `/athlete/plans`.
- Header subtitle drops the athlete name: just `Coach {coachName}`.
- `SessionTimer` calls the athlete submit fn; toast becomes `Sent to Coach {coachFirstName}` with description `Your session · {stateLabel}`.
- `SessionFeedbackModal` heading: `How did today feel?` (second person), button: `Submit to Coach {coachFirstName}`.
- `AthleteBottomNav` at the bottom.
- Same `errorComponent` / `notFoundComponent` shape, scoped to `/athlete/plans`.

## 7. Wire up the existing `/athlete` page

`src/routes/_authenticated/athlete.tsx` currently has no nav. Add a CTA button "View my plans" → `/athlete/plans` and mount `AthleteBottomNav`. No other content changes.

## Technical notes

- All new code reads via the authenticated middleware client; uses `supabaseAdmin` only where the parent equivalents already do (cross-table coach lookups not visible to the athlete via RLS).
- The two existing query keys (`["parent-plans"]`, `["coach-plans"]`) are invalidated on athlete submit so cross-role views stay in sync without a refresh.
- No changes to `PlanCard`, `flow-state-bars`, the parent routes, or coach routes.
- Reuses `FLOW_STATES`, `SessionFeedbackModal`, `FlowStateScale`, `IdleSlide`, `RunningPill` by either importing from the parent file or duplicating into the athlete route file (will pick duplication to keep the two flows independently editable, matching the existing parent/coach split).

## Files

New: `supabase/migrations/<ts>_athlete_plan_sessions.sql`, `src/lib/athlete-plans.functions.ts`, `src/components/athlete/bottom-nav.tsx`, `src/routes/_authenticated/athlete.plans.index.tsx`, `src/routes/_authenticated/athlete.plans.$planId.tsx`.

Edited: `src/lib/plan-sessions.functions.ts` (new `submitAthletePlanSession`), `src/routes/_authenticated/athlete.tsx` (nav + CTA).
