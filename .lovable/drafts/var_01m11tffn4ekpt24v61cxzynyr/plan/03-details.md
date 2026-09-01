## Technical details

**Scope.** `src/components/board/skater-wheel.tsx` only, plus a possible one-line
fallback flip in `src/components/board/rink-panel.tsx`. No data, scraper, or
server-function changes.

**Step 1 — reproduce.** Playwright at 390px with `has_touch`, driving real
touch drags (CDP `Input.dispatchTouchEvent`) on `/board/demo`, asserting on the
rendered transform and on `window.scrollY`. Verified so far: a mouse drag does
move the cards, and the container computes `touch-action: pan-x`. Touch is
unverified — that's what this step settles.

**Step 2 — gesture hardening.** Applied together, independent of which one the
reproduction blames:
- `touch-action: none` on the wheel container instead of `pan-x`; the wheel does
  not need horizontal panning and `pan-x` still lets a browser claim a
  diagonal-ish drag.
- Non-passive `touchmove` listener registered via `addEventListener` in an
  effect, calling `preventDefault()` once a drag is recognised, so iOS Safari
  and the Capacitor webview cannot hand the movement to the scroller.
- `pointer-events` currently `none` on every non-centre card, so a drag that
  starts on a neighbouring card is lost. Move the pointer handlers to the
  container (already there) and keep the cards non-interactive for *clicks*
  only, so a drag can begin anywhere in the 3-slot window.
- Drag sensitivity: divide by a smaller effective step (roughly 60px per card
  rather than 84) so a short thumb flick clearly advances.
- Keep the existing `moved < 6` click guard so a drag never opens the protocol
  sheet.

**Step 3 — affordance.** Increase the visible peek of the ±1 cards (less scale
and opacity falloff, slightly tighter vertical spacing) so the stack reads as
spinnable rather than as one card with debris behind it. Tilt stays at the
current subtle 2° per step.

**Step 4 — the fallback.** If touch still fails after step 2, delete
`skater-wheel.tsx`, drop the `startOrder.length > 1` branch in `rink-panel.tsx`,
and render only the existing three `Lane` rows. `lane-parts.tsx` stays — the
static panel already imports it.

**Verification.** Prettier, `tsgo`, targeted ESLint, then the touch Playwright
pass from step 1 re-run to confirm the wheel moves under touch, springs back on
release, does not scroll the page, and logs no console errors.
