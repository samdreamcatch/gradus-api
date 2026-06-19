## Goal

Replace the row of sport chips on the onboarding "Which sports do you coach?" step with a multi-select dropdown. Add a "Custom…" entry at the bottom that lets the coach type their own sport name; for custom sports the coach also types their own level labels in the next step.

## Design system

All new UI uses existing primitives only — `Popover`, `Command` (CommandInput / CommandList / CommandItem / CommandGroup / CommandSeparator), `Button`, `Input`, `Badge`/pill, and the existing paper/ink tokens. No new colors, shadows, fonts, or one-off styles. The dropdown trigger reuses the same chip/button styling already used elsewhere in onboarding so it feels native to the flow.

## UI changes (src/routes/_authenticated/coach.onboarding.tsx)

Sports step:
- Replace the `SportChip` row with a single dropdown trigger (shadcn `Popover` + `Command`).
- Trigger shows selected sport labels joined ("Tennis, Golf, …") or the placeholder "Select sports".
- Dropdown body:
  - One selectable `CommandItem` per built-in sport from `SPORTS`, with a check mark on selected rows (standard shadcn pattern).
  - `CommandSeparator`, then a "Custom…" `CommandItem` at the bottom. Activating it reveals an inline `Input` + Add button inside the same popover.
  - Custom sports the coach has added also appear above the divider as checkable rows, with a small × to remove.
- Below the trigger, render the currently-selected sports as small removable pills using the existing badge/chip styling, so the selection is visible without opening the dropdown.

Duplicate handling for the custom input:
- On Add, slugify the typed label and compare case-insensitively against:
  1. Built-in `SPORTS` labels and keys.
  2. Already-added custom sport labels.
- If a match is found:
  - Do NOT create a new custom sport.
  - Auto-select the existing one (built-in or custom) if not already selected.
  - Show an inline hint inside the popover: "'Tennis' already exists — selected for you." Clear the input.
- If no match, create the custom sport and select it.

Levels step (custom-sport branch only):
- Built-in sports: unchanged (uses `sport.levels`).
- Each custom sport: editable list of level rows using the existing `Input` component. "Add level" button appends a blank row; each row has a × to remove. Adding a level implicitly selects it; hours step then iterates these like any other level.

## Data model (frontend-only)

Extend the in-memory shape used by the wizard so a "sport" can be built-in or custom, without changing `SPORTS` or the DB contract:

- `SelectedSport = { key: string; label: string; custom: boolean }`.
- `sports` state becomes `SelectedSport[]` instead of `SportKey[]`.
- `CustomLevel = { sportKey: string; key: string; label: string }` stored in a `customLevels` state array.
- `getSportMeta(key)` / `getLevelMeta(sportKey, levelKey)` helpers resolve built-ins first, then fall back to custom. All downstream code (levels list, hours list, review, submit payload) goes through these helpers.
- Custom sport key: `custom_` + slug + short random suffix. Custom level key: `lvl_` + slug + suffix.

## Submit payload

`saveOnboarding` already accepts free-form `sport` / `levelKey` strings (`coach_levels.sport` is `text`, and `validate_athlete_primary_coach` only checks that the sport exists in `coach_levels` for that coach). Custom sports/levels persist via the existing `entries` array — no migration required.

## Out of scope

- New sport libraries (seed data for more sports) — coming in a later step.
- Backend schema changes.
- Parent/athlete sport pickers.

## Files touched

- `src/routes/_authenticated/coach.onboarding.tsx` — dropdown UI on sports step, custom-level editor on levels step, refactor `sports` state and helpers.
- Possibly a small new component `src/components/onboarding/sport-multiselect.tsx` (using only existing primitives) to keep the route file readable.
- No changes to `src/lib/coach-sports.ts`. `SportChip` left in place; only removed if no remaining references.
