## Goal
Fit both plan cards (Coach + Coach Pro) on a single mobile viewport (~390×822) without scrolling, using existing design tokens and components only.

## Approach
Tighten vertical rhythm across the paywall page and switch the plan cards to a mobile-optimized layout. No new components, no new tokens.

### 1. Compress the page header (src/routes/_authenticated/coach.paywall.tsx)
- Reduce top padding: `py-8` → `py-5`
- Drop the Sparkles icon circle (saves ~72px including margin), or shrink `h-12 w-12` → `h-9 w-9` and `mb-6` → `mb-3`
- Subhead: tighten `mt-2` → `mt-1.5`, keep copy
- Interval toggle: `mt-6` → `mt-4`
- Plans grid: `mt-6` → `mt-4`, gap `gap-4` → `gap-3`

### 2. Make plan cards mobile-first horizontal-compact
Currently each card is a tall vertical block. On mobile only, restructure so the two cards stack but each card is dense:
- Card padding: `p-6` → `p-4`
- Price row + title on one line: keep title left, price right (already close — just tighten `mt-3` → `mt-2`)
- Feature list: `mt-5 space-y-2` → `mt-3 space-y-1.5`, drop trailing "Priority support" wrap by keeping list as-is (already 4–5 items)
- CTA button: `mt-6` → `mt-4`, use existing `size="sm"` variant on mobile via `className` (Button already supports size)
- Billed line `mt-1` stays

### 3. Trim footer blocks on mobile
- "Joining through a club?" card: `mt-8` → `mt-5`, `p-4` → `p-3`
- Sign out section: `mt-8 pt-4` → `mt-5 pt-3`

### 4. Verify
Take a mobile screenshot at 390×822 via Playwright after build mode is enabled and confirm the second card's CTA is above the fold.

## Technical notes
- All spacing changes use existing Tailwind utility scale — no token or component changes.
- Grid stays `sm:grid-cols-2`; on mobile it remains a single column but each card is ~40% shorter, which should bring both above the fold along with the header.
- If still overflowing after tightening, the fallback is to promote the grid to `grid-cols-2` at mobile too (two narrow side-by-side cards). This is a secondary lever; try the tightening pass first since side-by-side cards on 390px get cramped for the feature list.

## Out of scope
- No copy changes
- No new components or tokens
- No changes to pricing logic or Stripe wiring
