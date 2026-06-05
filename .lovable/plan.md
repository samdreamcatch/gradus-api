## Goal

Same visual container — rounded light-blue panel holding a pill toggle and the filter chips — on `/coach/plans`, `/parent/plans`, and `/athlete/plans`. Add a "Plans / Goals" toggle to `/athlete/plans` while we're in there (Goals shows a placeholder for now, like parent does).

## Approach

### 1. New shared component
`src/components/plans/filter-bar.tsx`
- Pure presentational wrapper.
- Classes: `rounded-[28px] bg-[#DCEAF5] p-2.5 shadow-sm dark:bg-[#1c2a3a]`.
- Renders `children` — each page passes its own `SegmentedToggle` + filter chip row.
- Internal spacing handled by callers (mt-2.5 between toggle and chips, matching the existing parent look).

### 2. `/parent/plans` (`src/routes/_authenticated/parent.plans.index.tsx`)
- Replace the inline `<div className="mt-4 rounded-[28px] bg-[#DCEAF5] …">` with `<FilterBar className="mt-4">…</FilterBar>`.
- No behavior change.

### 3. `/coach/plans` (`src/routes/_authenticated/coach.plans.tsx`)
- Inside the existing sticky `<header>`, wrap `SegmentedToggle` + (`PlansFilterStrip` | `LibrarySearchStrip`) in `<FilterBar>`.
- Drop `mt-3` from `PlansFilterStrip`'s grid; switch to `mt-2.5` so spacing matches the other pages.
- Keep sticky-header behavior.

### 4. `/athlete/plans` (`src/routes/_authenticated/athlete.plans.index.tsx`)
- Add `const [tab, setTab] = useState<"plans" | "goals">("plans")`.
- Wrap a new `SegmentedToggle` (Plans / Goals) + the existing 3 filter Selects in `<FilterBar className="mt-4">`.
- When `tab === "goals"`, render the same placeholder card parent uses: dashed-border card with "Goals coming soon." in the hand font.
- When `tab === "plans"`, render the current list as-is.

### 5. Visual parity check
All three pages should render: blue rounded panel → white pill toggle (green active) → row of white pill dropdowns underneath. Spacing identical.

## Out of scope
- No changes to `SegmentedToggle` itself.
- No changes to filter logic, data fetching, or routing.
- Not promoting the blue to a design token this round — can follow up if you want it themable.
- Real Goals functionality on either athlete or parent — placeholder only.
