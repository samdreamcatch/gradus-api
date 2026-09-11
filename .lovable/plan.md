# Let the live list stay where you put it

Right now, when you drag through the skater list on the Live tab, it springs back to the skater on the ice the moment you let go. That fights you. This removes the spring-back entirely and gives you a plain way to return to now when you want it.

## What changes

- Dragging moves the list and it stays where you left it. No snap-back, no rebound.
- The list still settles onto a whole card so you never end up parked between two rows — that's a short settle, not a return.
- A small "Back to now" control appears under the list, in the same quiet style as the existing "earlier skater / later skater" buttons, only while you're away from the live skater. Tapping it glides back to the skater on the ice.
- If a new score arrives while you're browsing, the list stays put instead of jumping — but the "Back to now" control stays visible so you can catch up in one tap.

## What stays

The card design, lane colors, role labels, the earlier/later buttons, keyboard access, tap-for-protocol on the centered card, and all board data.

## Technical details

Scope: `src/components/board/skater-wheel.tsx` only. No data, route, or server changes.

- Drag release: `settle()` no longer springs back to 0. On release, the accumulated drag is folded into the persistent `step` state (rounded to the nearest whole card, clamped to the order bounds) and `offset` resets to 0, so the position is kept.
- Remove the auto-reset effect that zeroes `step` when `activeIndex` or the order length changes, so a refresh doesn't yank the user's position. Bounds are re-clamped against the new list length instead.
- Add a "back to now" button rendered only when `step !== 0`, sharing the existing `press-soft` / `font-mono text-nano uppercase` treatment of the earlier/later buttons, that animates `step` back to 0 (instant under `prefers-reduced-motion`).
- Keep `touch-action: none`, the non-passive listeners, the `SLOP` click guard, rubber-banding at the ends, `aria-current`, and the edge mask unchanged.

Verification: Prettier, `tsgo`, targeted ESLint, then a touch Playwright pass at 390px confirming the list holds position after release, the "back to now" control appears and returns to the live skater, the page doesn't scroll during a drag, and no console errors.
