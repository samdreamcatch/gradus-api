## Goal
The fixed bottom navigation on mobile sits too low (icons hug the safe-area edge). Make the bar slightly taller so icons read as vertically centered above the home indicator, across all three roles.

## Change
In all three nav components:
- `src/components/athlete/bottom-nav.tsx`
- `src/components/coach/bottom-nav.tsx`
- `src/components/parent/bottom-nav.tsx`

Add extra vertical breathing room above the safe-area inset so the icon/label block is centered in a taller bar:

- On the `<ul>`: add `min-h-16` (was implicitly ~56px from `py-2.5`) so the bar has a guaranteed taller content area, with `items-center` already present.
- On each item's inner `<span>`: bump padding from `py-2.5` to `py-3.5` so the icon+label group has more vertical space and reads centered.
- Keep `pb-[env(safe-area-inset-bottom)]` on the `<nav>` so the home indicator still gets its inset (the taller content sits above it, not overlapping it).

No structural, color, or layout-token changes; icons remain centered via the existing `items-center justify-center` flex.

## Out of scope
- Desktop layout (bar is mobile-first; change is purely vertical sizing).
- Icon size, label typography, active-state styling.
- Page bottom padding (`pb-24` on routes) — still clears the slightly taller bar.
