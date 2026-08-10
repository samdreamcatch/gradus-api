# Add description, cue, and why to Gradus starter program moves

## What's wrong

Gradus starter plans create each move with the element type as the description and empty `cue` and `why` fields (`src/lib/starter-programs.server.ts:64-66`). Coach-built plans always carry all three, so a starter plan looks half-finished when an athlete expands a move.

## What to build

1. **Author the coaching copy in the catalog.** Extend `StarterProgramMove` in `src/data/starter-programs.ts` with `description`, `cue`, and `why`. Every element used across the nine figure-skating programs (roughly 40 unique names) gets real text, defined once in a shared element dictionary keyed by element name so repeated elements (Double Axel, Change Foot Combo Spin, Step Sequence, etc.) stay consistent.

   Copy source: the existing `seed_moves` figure-skating library already has vetted description/cue/why for most jumps and spins under slightly different names ("Double axel", "Double Salchow + Double Toe Loop"). Reuse that wording where an element matches, and write matching-voice copy for the ones with no library entry (Fly Sit Spin, Change Foot Combo Spin, Fly Change Foot Combo Sit Spin, Layback Spin, Step Sequence, Choreo Sequence, and the Euler three-jump combos).

   Keep `elementType` as a per-element category label so the current "Solo jump" / "Jump combination" grouping still reads correctly; the description becomes the real explanation rather than the category.

2. **Write the fields through on creation.** Update `src/lib/starter-programs.server.ts` to insert the catalog's `description`, `cue`, and `why` into `plan_moves` instead of the element type and empty strings.

3. **Backfill existing starter plans.** Athletes who already have a Gradus plan (including the current test account) must not be stuck with blank notes. Add a one-time data update that fills `description`, `cue`, and `why` on `plan_moves` belonging to plans with `source = 'gradus'`, matching each row by move name against the new catalog.

## Notes

- No schema change: `plan_moves.description`, `.cue`, and `.why` already exist and are non-null.
- No UI change needed — the athlete, parent, and coach plan views already render all three when present.
