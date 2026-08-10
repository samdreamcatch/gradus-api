# New move: sport & category dropdowns

On the "New move" sheet inside a plan, Sport and Category are currently free-text inputs. Make both pickers, matching the "Add to library" dialog that already exists elsewhere on the same screen.

## Behavior

- **Sport** — dropdown of the coach's configured sports (same source the "Add to library" dialog uses). Defaults to the first sport.
- **Category** — dropdown of categories already used for the selected sport (from the coach's move library plus the built-in seed categories), plus an "Other…" option that reveals a small text field for a new category name. Resets when the sport changes.
- Saving works exactly as today; if "Other…" is chosen, the typed category is what gets saved.

## Technical notes

- File: `src/routes/_authenticated/coach.plans.$planId.tsx`, the `NewMove` form (Sport/Category block).
- Reuse the existing `listCoachSports` server fn + `listMoves` (`seedCategories`) query and the same `<select>` + `Input` "Other…" pattern already used by the `AddToLibrary` dialog in this file — no new components or styles.
- Drop the `datalist`/free-text `Input` for sport and the plain `Input` for category.
