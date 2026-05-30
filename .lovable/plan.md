## Root cause

In `getParentPlan` (`src/lib/parent-plans.functions.ts`), the coach lookup uses the user-scoped Supabase client. `coach_profiles` RLS only allows a coach to read their own row, so for a parent the query returns no data. Both `coachFirst` and `coachLast` fall back to `"Coach"`/`""`, and the detail page renders `Coach {plan.coachName}` → **"Coach Coach"**. The list page has the same bug (also falls back to `"Coach"`).

## Fix

Use `supabaseAdmin` (RLS-bypassing, server-only) for the coach-name lookup in both `listParentPlans` and `getParentPlan`. We're only projecting `first_name, last_name` for coach IDs that are already tied to plans the parent is authorized to see (gated by `is_parent_of_plan` / parent-profile join), so this is a safe, scoped read.

Changes, all in `src/lib/parent-plans.functions.ts`:

1. Add `import { supabaseAdmin } from "@/integrations/supabase/client.server";`
2. In `listParentPlans`, swap the `coach_profiles` query (currently using `supabase`) for `supabaseAdmin`, selecting only `id, first_name, last_name` filtered by the already-collected `coachIds`.
3. In `getParentPlan`, swap the single-row `coach_profiles` fetch to `supabaseAdmin`, selecting only `first_name, last_name` for `plan.coach_id`.

No schema/RLS migration, no UI change, no change to the parent's own access scope.

## Out of scope

- Plan list/detail UI
- Other server functions
- Coach-side flows