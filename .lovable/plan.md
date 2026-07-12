# Shrink all three bottom navigation bars

## Problem

On 390px-wide mobile, the coach nav tiles push text and icons off-screen. The labels currently render at `text-micro` (10px) with `tracking-widest` (0.1em) and heavy horizontal padding (`px-3`), and none of the bottom navs route through the design system's `<Eyebrow>` primitive — so they've drifted out of sync with its documented "component-level" role. Parent and athlete bottom navs share the same construction and need the same fix so all three stay consistent.

## Fix

### 1. Bottom nav components (apply identical rules to all three)
Files:
- `src/components/coach/bottom-nav.tsx`
- `src/components/parent/bottom-nav.tsx`
- `src/components/athlete/bottom-nav.tsx`

Changes in each file (identical tokens/spacing):
- Replace the hand-rolled label `<span>` with `<Eyebrow as="span" size="nano" tracking="wide" weight="bold" tone={...} />` so nav labels flow through the design system.
- Tighten the tile so items comfortably fit ≤360px:
  - Row padding: `px-2` → `px-1`
  - Tile padding: `px-3 py-3.5` → `px-1.5 py-2.5`
  - Icon size: `h-5 w-5` → `h-[18px] w-[18px]`
  - Gap: `gap-1` → `gap-1.5`
  - Label wrapper adds `truncate max-w-full` guardrail
- Preserve per-nav behavior untouched: active-state `pen-highlight`, unread dot (coach messages), any parent/athlete-specific badges or item sets, focus ring, safe-area padding.

Confirm before editing that parent/athlete navs share the same base structure; if one has a divergent shape (e.g. FAB slot), keep that shape and only swap in the shared tokens/label primitive.

### 2. `src/components/ui/eyebrow.tsx` (design system update)
- Update the size doc block so the "bottom nav / dense tile label" role points at **`nano` (9px)**, not `micro`. `micro` becomes "card sub-labels / meta rows"; `nano` becomes "dense grids, rings, bottom nav tiles".
- No API change — just doc + intent alignment so future call sites match what the navs now use.

### 3. Verification
- Preview each role's bottom nav at 390px: all tiles visible with label + icon, no clipping, active pen highlight still reads.
- `rg "text-micro" src/components/{coach,parent,athlete}/bottom-nav.tsx` → no matches.
- Typecheck clean.

## Out of scope

- No token changes to `text-nano` / `text-micro` sizes themselves; the fix is *using the right token*, not resizing tokens.
- No changes to top nav / page headers / other Eyebrow call sites.
