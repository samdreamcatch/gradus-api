## Problem
Only the athlete's name is a button inside `RosterCard`. Tapping the schedule pills or "+ Taylor" chip does nothing.

## Scope
`RosterCard` is a single shared component in `src/components/coach/roster-card.tsx`. Editing it updates every place it renders (roster list, and any other surface that imports it) — no per-call-site changes needed.

## Change
In `src/components/coach/roster-card.tsx`:
- Turn the outer card `<div>` into a `<button type="button">` that calls `onSelect?.(athlete.athleteId)`. It already has the `press` styling.
- Demote the inner name `<button>` to a `<span>` (drop the redundant onClick + focus-surface, keep typography classes).
- Keep the kebab `DropdownMenu` trigger; stop click propagation on its wrapper so opening the menu doesn't also open the athlete sheet.
- Move the `AlertDialog` out of the card button and render it as a sibling, so we don't nest buttons inside a button (invalid HTML).

## Result
Tapping anywhere on the card — name, "No schedule" / schedule pills, or the "+ Taylor" chip — opens the athlete detail everywhere the card is used. Kebab menu and destructive confirm still work independently.
