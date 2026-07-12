## Goal

Converge on one filter picker style — the rounded dropdown pills used on `/coach/plans` (Active ▾ · All athletes ▾ · All sports ▾) — and retire the square/chip-based `SportFilterChips` on `/coach/roster`.

## Why

- Roster's chip row and Plans' dropdown row solve the same job (narrow a list by sport/athlete/status) with two different visual languages. Two languages = two mental models on the same product surface.
- The dropdown pill scales: it stays one row regardless of how many sports exist, and it composes naturally with sibling filters (athlete, status).
- Chips are only nicer when the option set is ~2–3 and stable. Roster will grow past that as coaches add sports.

## Approach

Extract the trigger pattern into one primitive and use it in both places.

### 1. New shared component: `src/components/ui/filter-pill.tsx`

Thin wrapper around shadcn `Select` that codifies the pill styling currently inlined as `triggerClass` in `coach.plans.tsx`:

```tsx
<FilterPill
  value={selectedSport ?? "__all"}
  onValueChange={(v) => setSelectedSport(v === "__all" ? null : v)}
  aria-label="Sport"
  placeholder="All sports"
  options={[
    { value: "__all", label: "All sports" },
    ...sports.map((s) => ({ value: s, label: sportLabel(s) })),
  ]}
/>
```

Encapsulates: rounded-full pill trigger, `h-8`, `text-xs font-bold`, `border-foreground/15`, `bg-popover`, `__all` sentinel handling, disabled state when `options.length <= 1`.

### 2. Refactor `/coach/plans`

Replace the three inline `<Select>` blocks in `PlansFilterStrip` (lines 184–233 of `coach.plans.tsx`) with three `<FilterPill>` calls. Same 3-column grid, same behavior, ~40 fewer lines. No functional change.

### 3. Refactor `/coach/roster`

- Delete `src/components/coach/sport-filter-chips.tsx`.
- In `coach.roster.tsx`, replace the `<SportFilterChips>` block (lines 154–160) with a single `<FilterPill>` for sport. Wrap in the same `grid` container shape as plans so it visually rhymes:
  - When there's only one sport: render the pill disabled (shows the sport label, no chevron interaction) — mirrors the current single-chip affordance.
  - When there are 0 sports: render nothing (current behavior).
- Keep the segmented Athletes/Schedule toggle above it unchanged — that's a different control (view switcher, not a filter).

### 4. Doctrine note

Add a short comment block at the top of `filter-pill.tsx`: "Use for list filters (status, entity, taxonomy). Not for primary navigation or view toggles — those stay segmented."

## Out of scope

- No changes to the segmented Plans/Move library or Athletes/Schedule toggles.
- No changes to the `Chip` component itself — it's still used for tags, badges, and other non-filter surfaces.
- No changes to athlete.plans / parent.plans filter strips (they already use the same inline Select pattern; can be migrated in a follow-up if desired).

## Verification

- Visual: `/coach/plans` looks identical; `/coach/roster` now shows one "All sports ▾" pill instead of a chip row.
- Behavior: selecting a sport on roster filters the athlete list the same way it does today.
- `bunx tsgo --noEmit` clean; `bunx eslint src/` clean.
