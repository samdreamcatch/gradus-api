In `src/routes/_authenticated/coach.roster.tsx` (lines ~132–172), rebalance the filter/action row so the three controls share width evenly:

- Wrap the sport `FilterPill`, "Add to Roster" button, and lesson button each in `flex-1 min-w-0` containers so they split space equally instead of the pill hogging the row and the buttons shrinking to icon-only.
- Make each `Button` `w-full` and drop `shrink-0`; drop `sr-only` on their labels so "Add to roster" and "Add event" always render (icon + text, text truncates if needed).
- Rename the second button's label from "New lesson" to "Add event".
- When there are no sports yet, keep the pill slot as an empty `flex-1` spacer (existing behavior).
- When the lesson button is hidden (non-schedule tab or no athletes), render an empty `flex-1` spacer in its slot so the remaining two still split evenly rather than expanding to fill.

No changes to `FilterPill` itself or to other files.