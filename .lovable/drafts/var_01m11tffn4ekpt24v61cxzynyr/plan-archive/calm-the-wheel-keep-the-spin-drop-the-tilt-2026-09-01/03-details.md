## Technical details

Scope: `src/components/board/skater-wheel.tsx` only. No data, scraper, route, or
server-function changes. `rink-panel.tsx` keeps using the wheel unchanged.

- Remove the `TILT` constant and the `rotate(...)` term from the card transform.
- Retune falloff: scale floor around `0.96` (from `0.92`) with roughly `0.02` per
  step, and opacity around `0.18` per step instead of `0.26`, so ±1 is clearly
  legible and ±2 reads as an edge rather than vanishing.
- Slot spacing stays near the current `STEP - 6`; with no tilt the cards no longer
  need extra clearance, so the peek reads cleaner at the same height.
- Snap on release: in `settle()`, animate to the nearest whole card offset first
  (short, ~180ms), hold briefly, then run the existing return-to-live spring.
  Reduced-motion keeps the current instant reset.
- Edge mask on the container via `mask-image: linear-gradient(to bottom,
  transparent, black 12%, black 88%, transparent)` so cards fade instead of
  clipping.
- Reduce the spring overshoot slightly so the settle reads as a detent rather
  than a bounce.
- Everything else — the non-passive pointer/touch listeners, `touch-action: none`,
  `DRAG_STEP`, the `SLOP` click guard, the earlier/later buttons, `aria-current`,
  and keyboard handling — stays exactly as it is.

Verification: Prettier, `tsgo`, targeted ESLint, then a touch Playwright pass at
390px confirming the stack still drags, snaps to a card, returns to the live
skater, does not scroll the page, and logs no console errors.
