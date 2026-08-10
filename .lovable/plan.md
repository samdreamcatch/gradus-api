# Fix: Gradus starter plan detail fails to open

## What's happening

Opening a Gradus starter plan from the Plans list throws "Something went wrong." Gradus plans have no coach, so the plan detail lookup asks the database for a coach with an empty ID. The database rejects an empty string where a real ID is expected, and the whole request fails before the plan can render.

This is confirmed: `src/lib/athlete-plans.functions.ts:235` queries `coach_profiles` with `.eq("id", plan.coach_id ?? "")`, and any database error there is converted into the generic error the user sees.

## The fix

1. In `src/lib/athlete-plans.functions.ts` (`getAthletePlan`), only run the coach lookup when `plan.coach_id` is set. When it's null, skip the query and use the existing "Gradus" attribution path.
2. Apply the same guard in `src/lib/parent-plans.functions.ts:228`, which has the identical pattern and will break the same way when a parent opens a Gradus plan.
3. Check `src/lib/starter-programs.functions.ts:40` (`.eq("athlete_id", plan.athlete_id ?? "")`) for the same empty-ID risk and guard it if the value can be null.

## Verification

Open a Gradus starter plan as an adult athlete and as a parent; both detail screens should load with "from Gradus" attribution and the move list.
