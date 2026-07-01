## Goal

When a coach edits a move inside a plan and that move is linked to a library move, offer two one-click actions:

1. **Update library move** — push the plan-move's current text/targets back to the library entry (all future plans referencing it get the new version going forward; existing plan_moves rows are unchanged because they store their own copy of the fields).
2. **Save as new library move** — fork the edits into a brand-new library entry, then re-point this plan-move at the new library id. Picks sport + category (same UX as the existing "Add to library" dialog).

If the plan-move is unlinked, the existing "Add to library" card stays as-is.
If the plan-move is linked and unchanged, no affordance is shown.

## UX

Inside each expanded move card in the plan editor (`src/routes/_authenticated/coach.plans.$planId.tsx`), below the fields, add a small "library sync" strip that mirrors the styling of the existing "Not in your library" card:

```text
[ Library ]  Edited from "<library move name>" · description, cue changed
                          [ Update library move ]  [ Save as new move ]
```

Only shown when `move_id` is set AND at least one of {name, description, cue, why, target_kind, target_value} differs from the linked library row.

- "Update library move" → confirm dialog listing the fields that will change → mutation → toast.
- "Save as new move" → reuse the existing sport/category picker dialog → mutation → the plan-move is now linked to the new library id, strip disappears.

## Data / server

`src/lib/moves.functions.ts`:

- Extend `listMoves` return (or add a lightweight `getMoveSnapshots` fn) so the editor can diff plan-moves against their linked library rows. Simplest: the plan detail loader already fetches plan_moves; add `libraryMove` snapshot (name/description/cue/why/target_kind/target_value) to each move DTO in `getPlan` (`src/lib/plans.functions.ts`) via a single `moves` lookup keyed by the plan_move's `move_id`.
- New `updateLibraryMoveFromPlanMove({ planMoveId })`:
  - Verify coach owns both the plan and the linked library move.
  - Copy name/description/cue/why/default_target_kind/default_target_value from plan_moves → moves.
  - Require non-empty cue and why (same guard as the existing add flow).
- New `forkPlanMoveToLibrary({ planMoveId, sport, category })`:
  - Same as `addPlanMoveToLibrary` but does NOT require `move_id` to be null; after insert, updates `plan_moves.move_id` to the new library id.
  - We can implement this by relaxing the existing `addPlanMoveToLibrary` guard OR (cleaner) add a sibling fn `forkPlanMoveToLibrary` that shares a private helper. Recommend the sibling to keep the "add" flow's semantics.

No schema changes. No new tables.

## Diff detection

Client-side, trimmed string compare for text fields and strict equality for target_kind/target_value. Show which fields changed as a comma-separated list in the strip subtitle so the coach knows what "Update" will do.

## Files touched

- `src/lib/plans.functions.ts` — include linked library snapshot in the plan DTO for each move.
- `src/lib/moves.functions.ts` — add `updateLibraryMoveFromPlanMove` and `forkPlanMoveToLibrary`.
- `src/routes/_authenticated/coach.plans.$planId.tsx` — new `LibrarySyncStrip` component rendered inside each expanded move, wired to the two mutations; invalidate plan + moves queries on success. Reuse the existing sport/category dialog for the fork flow.

## Out of scope

- Retroactively updating other plans that reference the same library move (they keep their own copies — this matches how plan_moves already works).
- Bulk "update all edited moves at once" — per-move only for MVP.
- Version history for library moves.

## Open question

When the coach clicks "Update library move", should we ALSO refresh this plan-move's snapshot so the strip disappears (it will naturally, since after the update the two rows match)? Assumed yes.
