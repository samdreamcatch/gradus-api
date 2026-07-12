## Chip / Tag primitives — DONE

`src/components/ui/chip.tsx` and `src/components/ui/tag.tsx` codify the pill vocabulary. Chip exposes `size` (nano/micro/caption/small — matches Eyebrow), `tone` (default/accent/muted/destructive), `weight`, `tracking`, `selected`, `mono`, `caseSensitive`, and `as`. Auto-renders `<button>` when `onClick` is passed; use `as="button"` explicitly when passing other button-only props (`disabled`, typed handlers) so TS infers correctly. `chipClasses()` helper is exported for TanStack Router `<Link>` sites, where the generic doesn't survive through `<Chip as={Link}>`.

Tag defaults to `font-mono` + `micro` (10px) + `default` tone — the `test`/`adult`/`test user` stamps.

## Sites converted

- `admin.errors.tsx` — status toggle Link → `chipClasses`
- `admin.feedback.tsx` — status toggle Link + inline Mark-resolved button
- `admin.map.tsx` — test-user Link
- `admin.list.$kind.tsx` — filter Links, test-toggle button, pagination Link, test Tag
- `admin.index.tsx` — 6 header action Links, copy button, TestToggle helper, 2 test Tags
- `admin.users.$userId.tsx` — mark-test button, delete-user destructive button, 2 Tags (`test user`, `adult`)
- `signup.parent.athletes.tsx` — coach-sport display Chips
- `coach/sport-filter-chips.tsx` — single-sport label + filter row
- `coach/roster-settings-section.tsx` — Remove destructive Chip
- `global-error-boundary.tsx` — Reload Chip

## Deferred (documented in plan discussion)

- `parent.settings.tsx` (2 sport-toggle sites) and `parent/add-coach-by-code-card.tsx` (2 sites) — use `border-2` and are case-sensitive labels. Same family as `onboarding/sport-chip.tsx`. Belongs to a future SportChip primitive.
- `coach/roster-card.tsx` line 112 — day+time slot pill, mixed-case with tabular-nums. Belongs to a future TimeSlotPill primitive.
- `coach/week-schedule-view.tsx` pen-colored pills — need a per-pen tone API you rejected.
- `admin.feedback.tsx` line 87 `test` stamp — uses `rounded` (not pill). Kept as-is.
