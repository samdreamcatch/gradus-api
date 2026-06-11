## What's causing it

On mobile (especially iOS Safari), the whole page can be dragged/rubber-banded because:

1. **No `overscroll-behavior` on `html`/`body`** in `src/styles.css`. Browsers default to letting the document bounce when you drag past the top/bottom, and that bounce drags the entire app (gradient background, fixed bottom nav, sticky footers) with it.
2. **`background-attachment: fixed` on `body`** (line 206) combined with the bouncing document makes the gradient/paper texture visibly slide independently of content, which exaggerates the "the screen is moving everywhere" feeling.
3. **Every page wraps content in `min-h-dvh`** and the `<body>` itself scrolls. The fixed `CoachBottomNav` / `AthleteBottomNav` / `ParentBottomNav` stay put, but the sheet overlays and pull-to-refresh gesture on the body let the user drag the page around behind them.
4. **iOS pull-to-refresh / swipe-back** are also enabled by default on the document scroller, which contributes to horizontal/vertical drift.

Nothing in `src/styles.css` currently sets `overscroll-behavior`, `touch-action`, or otherwise tames the document scroller — so the browser defaults win.

## Plan

Single, small CSS-only change in `src/styles.css` (inside the existing `@layer base` block). No component or layout changes.

1. Add to `html`:
   - `overscroll-behavior: none;` — disables rubber-band + pull-to-refresh on the root scroller.
   - `height: 100%;` — keeps the document constrained so the body is the only scroller.

2. Add to `body`:
   - `overscroll-behavior-y: none;` — belt-and-braces for iOS, which sometimes only honors the rule on the body.
   - `overscroll-behavior-x: none;` — kills sideways drift from horizontal swipes.
   - Keep `min-height: 100vh` and the existing gradient/paper texture, but the bounce will stop so `background-attachment: fixed` no longer visually slides.

3. Leave sheets, dialogs, and the bottom nav alone — they already render correctly once the document stops bouncing.

### Technical details

```css
@layer base {
  html {
    height: 100%;
    overscroll-behavior: none;
  }
  body {
    overscroll-behavior-x: none;
    overscroll-behavior-y: none;
    /* existing rules unchanged */
  }
}
```

### Out of scope

- No changes to bottom nav, sheets, or route layouts.
- Not switching to a fixed-body / inner-scroller architecture (heavier refactor; only needed if the simple `overscroll-behavior` fix doesn't fully resolve it on iOS).
- No changes to `background-attachment: fixed` unless the bounce fix alone doesn't make the gradient feel anchored — we'll revisit only if you still see drift after the fix.
