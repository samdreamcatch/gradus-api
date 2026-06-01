# Brand-align the SSR fallback error screen

## File
- `src/lib/error-page.ts` — only file changed. Stays dependency-free (no imports from the app, no Google Fonts, no external CSS/JS) so it survives a total app failure.

## Keep
- Current copy verbatim:
  - H1: "This page didn't load"
  - Body: "Something went wrong on our end. You can try refreshing or head back home."
  - Buttons: "Try again" (refreshes) and "Go home" (links to `/`)
- Same exported function signature: `renderErrorPage(): string`.
- Same usage from `src/server.ts` — no changes there.

## Visual changes (all inline)
- **Paper background**: `#F5F6FA` with a faint inline SVG fractal-noise grain overlay (~12% opacity) and 32px ruled horizontal lines (~7% opacity), matching `<AppBackground />`.
- **Card**: white `#FFFFFF`, `border-radius: 20px`, inset top highlight + soft drop shadow approximating `--shadow-card`. Max-width ~28rem, centered.
- **Typography** (system fallbacks only — Fraunces/Caveat/Atkinson are not guaranteed to load in a failure state):
  - H1: `Georgia, "Times New Roman", serif`, 30px, weight 600, color `#1F2937`, slight negative tracking.
  - Body: `system-ui, -apple-system, sans-serif`, 15px, color `#6B7280`.
- **Pen highlight** under the H1 word "load": inline gradient span behind the glyph, Tennis wash → transparent, rotated -2.5deg — same technique as `src/components/logo.tsx`.
- **Buttons**:
  - Primary "Try again": Tennis fill `#8DE160`, ink `#1F4D00`, pill radius, subtle shadow, hover darkens via `filter: brightness(0.96)`.
  - Outline "Go home": white fill, 1px `#E6E7EB` border, `#1F2937` text.
- **Bouncing tennis ball above the card**:
  - 56px circle, fill `#8DE160`, with two curved white seam strokes (inline SVG).
  - Sits on a soft elliptical shadow that scales inversely as the ball rises (squash/stretch feel).
  - Pure CSS `@keyframes` — `bounce` (translateY with `cubic-bezier(.5,0,.5,1)` for gravity feel) on the ball, paired `shadow` keyframe on the shadow ellipse. ~1.1s loop, infinite.
  - Respects `@media (prefers-reduced-motion: reduce)` → animation paused, ball rendered at rest.

## Layout sketch
```text
        (  o  )     ← bouncing tennis ball
        _____       ← soft shadow ellipse
   ┌──────────────────────┐
   │                      │
   │   This page didn't   │
   │        load          │   ← "load" gets the Tennis highlighter
   │                      │
   │   Something went…    │
   │                      │
   │  [Try again] [Home]  │
   │                      │
   └──────────────────────┘
        (paper bg + grain + ruled lines)
```

## Constraints / invariants
- No `<link>` to Google Fonts, no external stylesheet, no JS beyond the existing inline `onclick="location.reload()"`.
- All colors as raw hex (tokens aren't available in this standalone HTML).
- File must remain importable from `src/server.ts` with no other app dependencies.
- Total page weight stays tiny (inline SVGs only, no base64 images).

## Out of scope
- `__root.tsx`'s in-app `ErrorComponent` / `NotFoundComponent` are not touched (per your "just the SSR fallback" choice).
