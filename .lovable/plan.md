## Plan

1. Add athlete-facing read access rules for the existing goal tables so a signed-in athlete can read their own:
   - goal rows in `athlete_goals`
   - primary coach mappings in `athlete_primary_coaches`

2. Keep the `/athlete/plans` UI as-is, since it is already calling the correct athlete goals server function and the goal record for Beverly is present in the backend.

3. Validate the data path end-to-end on `/athlete/plans` → Goals and confirm Beverly’s seeded goal now renders instead of the empty state.

## What I found

- Beverly already has a goal row in the backend.
- Beverly also has session data and a primary coach mapping.
- The athlete page is querying the right server function.
- The current backend access rules allow parents and coaches to read those goal tables, but not the athlete themself, so the athlete query resolves to an empty goals list.

## Technical details

- This should be a backend policy change only; no new route or frontend architecture change is needed.
- I’ll add narrowly scoped read rules based on the signed-in athlete’s own `athletes.user_id` mapping, so athletes can only read rows tied to their own athlete record.
- After that, I’ll re-check the page to make sure the goal card appears and the placeholder disappears.