## Problem

The primary-coach selector already exists end-to-end (data model, server fn `setPrimaryCoach`, RLS, UI) — but the picker only renders inside **Goals → \[sport row\]**, and only when 2+ coaches are linked for that sport. Looking at Jamie Gilmore in the Coaches section, there's no indication that a primary can be set, so it feels like the feature is missing.

## Change

Add a compact "Primary coach" row per sport inside the **Coaches** subsection of each athlete on `/parent/settings`. The Goals row stays as-is (so the choice is visible where it matters for goal-setting too), but the Coaches section becomes the natural place to manage it.

### Behavior
- For each sport that has 2+ linked coaches (same `eligibleCoaches` derivation already used by Goals), render a row:
  - Label: sport name (e.g. "Figure skating")
  - Trailing: a Select with each eligible coach; current value = `primaryCoachId`
  - Helper text under the section: "Pick a primary coach when more than one coach handles the same sport. Your goals follow the primary."
- For sports with only one coach, show a read-only line: "Figure skating — Tami Taylor (only coach)" — so the parent understands there's nothing to choose.
- Sports with zero linked coaches are omitted.
- On change → call existing `setPrimaryCoach` server fn → toast + invalidate `["parent-settings"]`.
- If the athlete has no sports at all (no `coach_athlete_sports` rows yet), skip the block silently.

### Placement in the Coaches disclosure
At the bottom of the Coaches list, after the linked-coach rows and before "Link another coach", add a thin grouped block titled "Primary coach per sport".

## Files to touch

- `src/routes/_authenticated/parent.settings.tsx`
  - Inside `CoachesSection`, render a new `PrimaryCoachPerSport` subblock driven by `athlete.sports` (already available in `AthleteData`).
  - Extract the `handlePrimaryChange` logic that exists today in `GoalsRow` into a small shared helper (or duplicate the 10-line call — it's tiny).
- No server, schema, or RLS changes. `getParentSettings` already returns `sports[].eligibleCoaches`, `primaryCoachId`, `primaryCoachName`.
