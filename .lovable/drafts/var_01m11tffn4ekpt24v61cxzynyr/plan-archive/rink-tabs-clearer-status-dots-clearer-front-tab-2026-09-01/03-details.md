## Technical notes

- `src/styles.css` — add a `board-live-dot` utility: accent dot plus an `&::after` halo ring running a ~2s expand-and-fade keyframe, disabled inside `@media (prefers-reduced-motion: reduce)`.
- `src/routes/board.$slug.tsx` (rink tab strip):
  - Render a dot for every rink: `board-live-dot` when `rink.state === "live"`, otherwise a static `bg-text-tertiary` dot. Extend the existing `sr-only` text to read "live" / "idle".
  - Inactive tab classes move from `bg-elevated` to a recessed tone (a `divider`-tinted surface) with `text-text-secondary`, no shadow, and slightly less vertical padding than the active tab.
  - Active tab keeps `bg-card`, `text-text-primary`, `shadow-sm`, `z-10`, and the `-mb-px` overlap into the panel.
  - Add `whitespace-nowrap` to the tab buttons so labels stop wrapping/clipping.
- `src/components/board/rink-panel.tsx` already renders the LIVE / IDLE tag; no change.

No data or business-logic changes — `rink.state` ("live" | "idle") already drives all of this.
