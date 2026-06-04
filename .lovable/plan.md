## Changes to `/coach/roster`

### Sport filter chips (top of page)
- Compute unique sports across the coach's athletes from the existing roster query.
- If only one sport: render a single static label chip (e.g. uppercase tracking-widest "GYMNASTICS") under `PageTitle`, no interaction.
- If multiple: render a horizontal row of toggle chips ("All", then one per sport). Selected chip uses accent fill; others use `bg-card` with `border-divider`. Tapping filters the list. Default selection: "All".
- A–Z sort within the filtered list is preserved.

### Compressed roster card (match `PlanCard` proportions)
Reuse the same visual envelope as `src/components/plans/plan-card.tsx`:
- `rounded-2xl border border-divider bg-card shadow-card`, `p-4 pl-5`, left edge accent bar (`w-1.5`, `bg-[var(--pen-tennis)]`), hover lift.
- Single row layout (no second line):
  - Left: athlete name in `font-display text-lg font-black` (truncate).
  - Right: compact day/time chips, right-aligned, `shrink-0`. Chips stay as today (e.g. `Mon 4:00p`) but rendered smaller/tighter to fit one row on mobile. If chips overflow on narrow screens, wrap to a second tight row below the name with `text-xs`.
- Remove the sport label and the "with [parent]" line entirely.

### Empty state
- Unchanged: invite CTA when the coach has no athletes.
- When a sport filter yields zero results (shouldn't happen since sports come from the roster), fall back to "All".

### Out of scope
- Card detail view, schedule editing, parent display elsewhere, server function changes (sport + slots are already returned).

### Technical notes
- Pure frontend change. No edits to `src/lib/coach-roster.functions.ts`.
- `src/routes/_authenticated/coach.roster.tsx`: derive `sports = [...new Set(roster.map(a => a.sport))].sort()`, hold `selectedSport` state, filter list before rendering, render `SportFilterChips` above the list.
- `src/components/coach/roster-card.tsx`: rewrite to single-row, drop sport + parent props from the JSX (keep them on the type or remove — see question below).
- New small component `src/components/coach/sport-filter-chips.tsx` for the chip row.