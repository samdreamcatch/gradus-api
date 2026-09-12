## Behaviour

- First visit for a coach: the bubble opens automatically in that space instead of sliding up from the bottom.
- Collapsed: the small round mark button with the remaining-step count, parked above the bottom bar in the lower right.
- The remaining-step counter uses an opaque contrasting surface, border, and primary ink in both themes so the number remains clearly readable in dark mode.
- Expanded: the bubble sits directly above the button, right-aligned, roughly 20rem wide (capped to the screen with a margin), with the tail at its bottom-right pointing at the button.
- Tapping a step's action closes the bubble back to the button and opens the existing flow (schedule import, invite, or the plans page).
- Tapping outside the bubble, or the X, collapses it.
- If the page is scrolled, the bubble and button stay pinned to the screen so they never overlap content awkwardly.

## Technical notes

All in `src/components/coach/getting-started-checklist.tsx`:

- Drop the `Sheet` usage and the `useVisualViewport` sizing; render one fixed-position container in the lower right holding either the button or the bubble, with the existing `ChecklistBody` inside.
- Keep the localStorage `seen` / `minimized` keys per coach, so `seen` now controls "open on first visit" and `minimized` controls collapsed state.
- Add an outside-click and Escape handler for the expanded bubble; keep `aria-label`s and the existing `press` / `animate-scale-in` treatments.
- Keep accent tokens (`bg-accent`, `text-accent-foreground`, `bg-card` body) so it stays visible in dark mode.
- Give the counter badge an explicit opaque semantic surface and border rather than relying on the translucent card styling that currently loses contrast in dark mode.
- `z` index above page content but below the bottom nav bar; bottom offset keeps clear of the nav and the safe-area inset.
- No server, query, or data changes.
