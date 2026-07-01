
## Goal

Prevent two library moves belonging to the same coach from having identical names. When a save would create a duplicate, show a dialog letting the coach either rename the new move or overwrite the existing one.

## Scope of uniqueness

- **Per coach**, across all sports/categories (a coach's library is one namespace).
- **Case-insensitive** and trimmed (`"Forehand"` == `"forehand "` == `"FOREHAND"`).
- **Ignores archived moves** (`archived_at IS NULL`) — an archived move with the same name doesn't block a new one.

## Server changes (`src/lib/moves.functions.ts`)

Three insert/update paths need conflict detection. Instead of throwing, each returns a discriminated result so the client can prompt.

Return shape becomes either:
```ts
{ ok: true, move: MoveDTO }          // or { ok: true, moveId }
{ ok: false, conflict: { existingMoveId, name } }
```

1. **`upsertMove`** (library editor, "Add move" and rename): before insert/update, look up an active move with the same normalized name for this coach. If found and it's not the row being edited, return the conflict. Add a new `overwriteMoveId` optional input — when set, the handler updates that existing move instead of inserting/renaming a different one.
2. **`addPlanMoveToLibrary`** and **`forkPlanMoveToLibrary`** ("Add to library" / "Save as new" from the plan editor): same conflict check. Add optional `overwriteMoveId` — when set, update the existing library move in place and link the plan move to it (same effect as `updateLibraryMoveFromPlanMove` but targeting the coach-chosen existing move).

No DB migration required — the check is application-level so we can return a structured conflict rather than a raw Postgres error. (If we ever want a hard guarantee we can add a partial unique index later; not part of this plan.)

## Client changes

Add a shared `NameConflictDialog` component used by all three save flows:

- Body: "You already have a move named 'Forehand' in your library."
- Two primary actions:
  - **Rename** — closes the dialog and focuses the name input so the coach can pick a new name.
  - **Overwrite existing move** — re-submits the save with `overwriteMoveId` set. Confirms with a secondary "This will replace the cue, why, description, and target of the existing move" line so it's not a surprise.
- Cancel button dismisses.

Wire it into:
- `src/routes/_authenticated/coach.library.tsx` (or wherever `upsertMove` is called from the move editor form).
- `AddToLibrarySection` in `src/routes/_authenticated/coach.plans.$planId.tsx`.
- `LibrarySyncStrip`'s "Save as new" flow in the same file.

Each caller checks `result.ok`; if false, opens the dialog with the conflict details and the retry callback bound to the same server fn plus `overwriteMoveId`.

## Out of scope

- No cross-coach uniqueness (each coach's library is independent).
- No renaming of *existing* library moves triggering a conflict prompt beyond what `upsertMove` already covers.
- No merge/dedupe of already-duplicated rows created before this change (can be handled manually or in a later cleanup).
