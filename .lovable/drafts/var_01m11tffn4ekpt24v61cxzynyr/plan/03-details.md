## Technical details

**Data.** No scraper, snapshot, or server-function changes. `BoardCurrent.startOrder` already carries every skater in the live event with start number, name, club, and any posted score, so the wheel reads from data the board fetches today.

**New component** `src/components/board/skater-wheel.tsx`
- Takes `startOrder`, the index of the live skater, and the existing `onOpenScore` callback.
- Renders a fixed window of cards around the active index (roughly two above and two below) inside a clipped, fixed-height container so card height stays stable and the layout never reflows as the wheel moves.
- Each card keeps the existing `Lane` markup from `rink-panel.tsx` — the start-number column, name, club, and score column are extracted so both the wheel and the fallback render the same row.
- Transform per card is a function of its distance from the center offset: `rotate(±2deg per step)`, small `translateY`, `scale` down and opacity down as it goes out. All via inline `transform`/`opacity` style, no new CSS tokens.

**Gesture**
- Pointer events on the container (`pointerdown` / `pointermove` / `pointerup`, with `setPointerCapture`), `touch-action: pan-x` so vertical drags belong to the wheel and horizontal page gestures still work.
- Drag distance maps to a fractional offset; releasing animates the offset back to 0 with a short spring (CSS transition with a spring-ish cubic-bezier, or a rAF tween). Respect `prefers-reduced-motion` by snapping instead of springing.
- Rubber-banding at both ends of the start order so the first and last skater feel like edges.

**Refresh safety.** The wheel holds its own offset in local state. A 30-second refresh changes the underlying array and the active index; if the user is mid-drag the offset is preserved and only re-centers on release, so a new score never yanks the card out from under a finger.

**Accessibility**
- The wheel is a `listbox`-free, simpler construct: an ordered list with the centered card marked `aria-current="true"`, plus a visually hidden pair of "previous skater" / "next skater" buttons so keyboard and screen-reader users can step the same range without a drag.
- The existing polite live-region announcement for state changes is unchanged.
- The centered card remains the only tappable target for the protocol sheet, keeping the 44px minimum.

**Fallback.** If `startOrder` is empty or has fewer than two entries, render exactly today's three-lane card. No wheel, no regression.

**Verification.** Prettier, typecheck, targeted ESLint, then a Playwright pass at mobile width driving a drag on `/board/demo` to confirm the wheel moves, springs back, and logs no console errors.
