## Why the mismatch

The roster card's `+N coaches` pill counts every other coach linked to the athlete via `coach_athletes`. The Athlete Detail Sheet's "Also coached by" list, however, drops any coach who has no active/benched plans for that athlete (`coach-athlete-detail.functions.ts` line 514: `if (cplans.length === 0) continue`). Jamie has 3 other coaches linked, but only 1 has a shared plan on file — so the pill reads "+3" while only 1 card shows.

## Fix (chosen direction)

Keep the roster count as-is (all linked coaches) and expand the sheet to list every other coach, tagging plan-less ones so the count reconciles at a glance.

### Data — `src/lib/coach-athlete-detail.functions.ts`

- Remove the `if (cplans.length === 0) continue` filter so every entry in `otherLinks` becomes an `OtherCoachDTO`.
- For coaches with no active/benched plans, return them with `plans: []`, `activeCount: 0`, `benchedCount: 0`, and their `sports` (from `coach_athlete_sports`) still populated.
- Update the sort so plan-less coaches sink to the bottom (coaches with plans first, ordered by most recent `updatedAt`; then plan-less coaches alphabetically by last name).

### UI — `src/components/coach/also-coached-by-list.tsx`

- When a coach has `activeCount + benchedCount === 0`, render the row in a muted, non-interactive style:
  - Replace the meta line ("No active plans") with a `font-hand` note: "No shared plans yet".
  - Drop the `ChevronRight` and disable the button (or render as a `div` with no `press` affordance) so tapping doesn't open an empty sheet.
- Coaches with plans keep the current pressable card + chevron behavior.

### UI — `src/components/coach/other-coach-plans-sheet.tsx`

- No changes needed; plan-less coaches won't open this sheet.

## Out of scope

- Roster card pill styling and count logic — untouched.
- `OtherCoachPlansSheet` internals, plan/move rendering.
- Any business logic beyond the visibility filter.
