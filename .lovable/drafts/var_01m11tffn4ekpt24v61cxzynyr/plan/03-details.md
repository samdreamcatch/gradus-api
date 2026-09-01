## Technical notes

- `src/styles.css` — add a `board-live-dot` utility: a small accent dot with an `::after` halo ring running a 2s ease-out expand-and-fade keyframe, wrapped so `@media (prefers-reduced-motion: reduce)` drops the animation.
- `src/routes/board.$slug.tsx` (rink tab strip) — render the dot for every rink instead of only `state === "live"`: live uses `board-live-dot`, idle uses a plain `bg-text-tertiary` dot. Keep the existing `sr-only` text and extend it to say "idle" for non-live rinks.
- `src/components/board/rink-panel.tsx` already shows a LIVE / IDLE tag in the panel header, so the tab dot and the panel tag will agree; no logic change there.

No data or business-logic changes — `rink.state` ("live" | "idle") already drives this.
