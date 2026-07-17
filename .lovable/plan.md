## Goal
Bump Tami Taylor's roster to exactly 25 so the next add-athlete attempt trips the `enforce_coach_roster_cap` trigger and surfaces the roster-full toast.

## Approach
Tami is on the `coach` tier (cap 25) with 3 real athletes. I'll seed 22 disposable placeholder athletes attached to her and tag them so they're easy to clean up later.

## Steps
1. Insert one placeholder `parent_profiles` row (no `user_id`, name "QA Placeholder / Roster Filler") to own the seed athletes. If a row with that exact name already exists from a prior seed, reuse it.
2. Insert 22 `athletes` rows under that parent (`first_name = 'Filler'`, `last_name = 'NN'` for 01–22, `self_managed = false`, no birthdate needed).
3. Insert 22 `coach_athletes` rows linking each new athlete to `coach_id = e82ce1b6-c2c3-4c66-8d31-7b6ccb3a25cd`. The cap trigger allows inserts while count < 25, so all 22 land and the roster becomes exactly 25.
4. Verify: `SELECT count(*) FROM coach_athletes WHERE coach_id = 'e82ce1b6…'` returns 25.

All writes go through the `supabase--insert` tool (data-only, no schema change).

## Cleanup (later, on request)
One statement: `DELETE FROM parent_profiles WHERE first_name = 'QA Placeholder' AND last_name = 'Roster Filler'` — cascades remove the 22 athletes and their `coach_athletes` rows.

## Out of scope
- No changes to the trigger, cap values, tier, or any UI code.
- Not touching the 3 real athletes already on her roster.