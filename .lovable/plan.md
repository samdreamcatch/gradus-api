# /coach/plans — Build Plan

Backend for moves is already in place. Now wiring the UI (Power user compact direction) and the missing plan server functions.

## 1. Plan server functions (`src/lib/plans.functions.ts`)

- `listPlans({ status?, athleteId?, kind? })` — list coach's plans + per-plan aggregates (move_count, total_minutes summed from minutes-kind moves only).
- `getPlan(planId)` — plan + ordered `plan_moves` snapshots.
- `savePlan({ id?, title, notes, kind, athleteId?, moves: [{ position, moveId?, name, description, cue, why, targetKind, targetValue }] })` — upsert plan + replace its `plan_moves`. Enforces: a `plan` must have either `athleteId` OR be saved as `kind='template'`.
- `setPlanStatus({ planId, status })` — calls `activate_plan()` RPC when status=active; direct update when benched.
- `duplicatePlan(planId, { asTemplate?, athleteId? })`.

## 2. Route page (`src/routes/_authenticated/coach.plans.tsx`)

Translates Power user compact mockup into real components, using semantic tokens (no raw hex). Two tabs sharing the same shell.

### Plans tab
- Segmented toggle: Plans | Library (top, sticky)
- Single dense filter strip: chips Active / Benched / Templates + vertical divider + athlete `<Select>` ("All Athletes")
- Plan rows (divided list, no cards): serif title + relative time on right · athlete chip (tennis pen fill for active, muted for benched, outlined "Template") · status dot · meta row (icon + "N moves", icon + "X min")
- Benched rows dim to ~70% opacity
- Tap row → `/coach/plans/$planId`
- FAB bottom-right (tennis pen): opens action sheet → From scratch / From template / Duplicate

### Library tab
- Same shell, replaces filter strip: sport chips (rendered only if `coach_levels` > 1 sport) + search input
- Moves grouped by Category with serif section headers; rows show name, target ("3×10 reps" / "5 min"), 1-line cue snippet, edit chevron
- Tap row → opens move sheet (edit name/description/cue/why/default target)
- FAB → new move sheet

### Plan editor route (`src/routes/_authenticated/coach.plans.$planId.tsx`)
- Header: title field (serif, inline editable), notes (multiline)
- Ordered list of move rows: drag handle · name · inline target editor (kind toggle reps↔min, numeric value) · expand for per-plan cue/why overrides
- "+ Add move" → opens a library picker sheet (search, sport filter, group by category, multi-select)
- Footer summary: total moves · total minutes
- Action bar: Assign to athlete (Select) · Save as template (toggle) · Mark active (only when assigned) · Save

### New plan flow
- "From scratch" → creates draft plan, opens editor
- "From template" → template picker sheet → duplicates template into draft plan, opens editor
- "Duplicate" → plan picker → duplicate, opens editor

## 3. Data wiring

- TanStack Query via loader pattern from `tanstack-query-integration`: each route's loader calls `ensureQueryData`, component reads with `useSuspenseQuery`.
- Mutations invalidate `['plans', ...]` and `['moves', ...]` keys.
- All server fns guarded by `requireSupabaseAuth`.

## 4. Style mapping (mockup → tokens)

| Mockup | Token |
|---|---|
| `#FBFBF2` page | `bg-background` (paper) |
| `#C5E023` pen | `bg-accent` / `text-accent-foreground` |
| `#E5E5D5` divider | `border-divider` |
| Fraunces titles | `font-display` |
| Atkinson body | `font-sans` |
| Ruled 32px lines | already provided by `<AppBackground />` |

No raw hex in components.

## 5. Out of scope (Phase 2)

- AI text edits, voice
- Athlete-side viewer
- Template sharing across coaches
- Reordering animation polish (drag works, animation later)

## Open assumptions

- Plan editor lives at `/coach/plans/$planId` (separate route, not modal) so deep-linking works.
- Move picker is a sheet inside the editor, not a separate route.
- "Mark active" button is the same action as toggling status — auto-benches previous active plan for that athlete via `activate_plan()` RPC.

Approve to proceed with build.
