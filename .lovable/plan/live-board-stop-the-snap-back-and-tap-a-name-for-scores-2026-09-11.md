# Live board: stop the snap-back, and tap a name for scores

Two changes to the live board, both small.

## 1. Let the list stay where you put it

Right now, when you drag through the skater list on the Live tab, it springs back to the skater on the ice the moment you let go. That fights you.

- Dragging moves the list and it stays where you left it. No snap-back.
- It still settles onto a whole card so you never park between two rows.
- A quiet "Back to now" control appears under the list — same style as the existing "earlier skater / later skater" buttons — only while you're away from the live skater. Tap it to glide back to the skater on the ice.
- A new score arriving while you're browsing no longer yanks the list; "Back to now" stays available so you can catch up in one tap.

## 2. Tap a skater's name to see their scores

- In "Your skaters", tapping the skater's name opens the score sheet you already have.
- In the live list, tapping any skater card does the same, not just the centered one.
- The sheet shows every event that skater is entered in today. Events with a posted result show the full judged detail. Events still to come, or done but not yet posted, read "Results pending" with the event time.
- When results appear on the next refresh, they show up in that sheet.

## What stays

Card design, lane colors, role labels, follow/unfollow, the earlier/later buttons, keyboard access, and all board data. No new screens.

## Technical details

Scope: `src/components/board/skater-wheel.tsx`, `src/components/board/my-skaters.tsx`, `src/components/board/score-sheet.tsx`, and the wiring in `src/routes/board.$slug.tsx`. No data, scraper, or server changes.

**Snap-back removal (`skater-wheel.tsx`)**
- `settle()` no longer springs back to 0. On release, the drag is folded into the persistent `step` state (rounded to the nearest whole card, clamped to bounds) and `offset` resets to 0.
- Drop the effect that zeroes `step` on `activeIndex` / order-length change; re-clamp against the new length instead.
- Add a "back to now" button, rendered only when `step !== 0`, reusing the existing `press-soft` / `font-mono text-nano uppercase` treatment; animates `step` to 0 (instant under `prefers-reduced-motion`).
- Keep `touch-action: none`, non-passive listeners, `SLOP` click guard, rubber-banding, `aria-current`, and the edge mask.

**Tap for scores**
- `ScoreSheet` gains a second, optional mode: instead of a single `skater`, it can take a list of `{ eventLabel, skater }` for one athlete. Existing single-skater usage keeps working. Entries without `protocol` render a "Results pending" line with the event time inside the same Card/Eyebrow/Separator primitives already used there — no new component.
- `my-skaters.tsx`: the `<h3>` name becomes a button that opens the sheet for all of that skater's rows (the existing `groups[].rows`), reusing `press-soft`; per-row tap behavior is unchanged. Follow/unfollow chip stays a separate control.
- `skater-wheel.tsx`: any card is tappable, not only the centre one, and tappability no longer requires `protocol` — the sheet handles the pending case. The `SLOP` drag guard still prevents a drag from opening it.
- `board.$slug.tsx`: build the per-skater list from the existing `findMySkaters` matches (grouped by normalized name) so both entry points feed the same sheet state.

Verification: Prettier, `tsgo`, targeted ESLint, then a touch Playwright pass at 390px confirming the list holds position, "Back to now" appears and returns, tapping a name and a wheel card opens the sheet with results or "Results pending", and no console errors.
