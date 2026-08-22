# Surface coach visibility toggles in parent settings

## What's happening

The coach visibility toggles were built, but they only render on the Team plan page (`/parent/team`). Parent settings routes to that page only when the plan is **not** active — once you're on a Team plan, the settings Team section shows guardian management and never links there, so the toggles are unreachable from where you're looking.

## The fix

1. Extract the existing `CoachVisibilitySection` from the Team plan page into a shared component so both places render the same toggles (no new UI patterns, no new components beyond the extraction).
2. Add a "Coach visibility" entry to the Team group in `/parent/settings`, using the same `SettingsList` / `SettingsDisclosure` pattern the guardians hub already uses:
   - One disclosure per athlete that has connected coaches, showing each coach with the existing `Switch` and its status line (Off / On — add another coach to connect / Waiting on coaches to accept / Connected / Declined).
   - If the plan is active but no coaches are connected yet: "No coaches connected to your athletes yet."
   - If the plan is not active: keep the existing explanatory row that routes to `/parent/team`.
3. Keep the section on `/parent/team` as-is so both entry points work, sharing the same `coach-visibility` query key so toggling in one place refreshes the other.

## Technical notes

- New file `src/components/parent/coach-visibility-toggles.tsx` holding the extracted list; `parent.team.tsx` and `parent.settings.tsx` both import it.
- Data continues to come from `listCoachVisibility` / `setCoachVisibility` in `src/lib/coach-visibility.functions.ts` — no server or database changes.
- Query key stays `["coach-visibility"]`, invalidated after each toggle.
