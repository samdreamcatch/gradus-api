# Live view: make tapping a skater open their scores

Tapping a skater's name in "Following" opens the score sheet, but tapping a card in the "Live" tab does nothing. Two separate reasons, both fixable without new UI.

## Why it isn't happening

1. **The drag surface swallows the tap.** The live list captures your finger for dragging. Once it does that, the browser sends the "tap" to the whole list instead of the individual card, so the card's own tap never runs.
2. **Some live rows were never tappable.** When an event has only one skater listed, the Live tab shows three simple rows instead of the scrolling list. Only "Just scored" was tappable there, and only if the judged detail was already posted — so the skater on the ice and the one up next did nothing.

## What changes

- Tapping any card in the live list opens that skater's score sheet — the same sheet you get from Following, showing every event they're in today, with "Results pending" for ones not yet posted.
- Dragging the list still just drags; a drag never opens the sheet.
- In the simple three-row layout, all three rows (just scored, on the ice, up next) open the same sheet, pending or not.
- No visual changes beyond the existing press feedback and the small detail hint already used on tappable cards.

## Technical details

`src/components/board/skater-wheel.tsx`
- Resolve the tap inside the existing native `pointerup` handler rather than a React `onClick` on the card: the container calls `setPointerCapture`, which retargets the synthesized click to the container, so per-card `onClick` never fires on touch.
- Tag each card element with a `data-skater-index`; on pointerup with `moved < SLOP`, walk up from `e.target` via `closest("[data-skater-index]")` and call `onOpenScore(startOrder[index])`.
- Keep the keyboard handler (Enter/Space) on the card for a11y; drop the now-redundant `onClick` to avoid double-firing on mouse, or guard it with the same `moved` check.

`src/components/board/rink-panel.tsx`
- `Lane`: make `tappable` depend only on `onOpenScore` (drop the `protocol` requirement) — the sheet already renders the pending state.
- Pass `onOpenScore` to the "on the ice" and "up next" lanes as well.
- Keep `showDetailHint` tied to `skater.protocol` so the hint only shows where there is judged detail.

No route, data, or server changes; `board.$slug.tsx` already passes `openByName` into `RinkPanel`.

Verification: Prettier, `tsgo`, targeted ESLint, then a touch Playwright pass at 390px on the Live tab confirming a tap opens the sheet, a drag does not, and the list still holds position.
