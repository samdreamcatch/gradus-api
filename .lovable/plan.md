# Shrink bottom nav labels one step further

## Problem

`nano` (9px) still reads too large in the bottom nav on mobile. `Eyebrow`'s smallest size is 9px, so we need a new smaller step in the design system rather than a one-off className override.

## Fix

### 1. Add a new size token to the Eyebrow scale
`src/styles.css` — add a new utility next to `text-nano`:
```css
@utility text-pico {
  font-size: 8px;
  line-height: 1.2;
}
```

### 2. Extend `Eyebrow` (and `Chip`/`Tag` for consistency)
`src/components/ui/eyebrow.tsx`:
- Add `"pico"` to `EyebrowSize` union.
- Map `pico: "text-pico"` in `SIZE_CLASS`.
- Update doc block: `pico (8px) — bottom-nav tile labels`; `nano (9px) — dense grids, rings`.

`src/components/ui/chip.tsx` and `src/components/ui/tag.tsx`:
- Add `"pico"` to their size unions with matching `text-pico` + tight padding (`px-1.5 py-0.5` for Chip; `px-1 py-0.5` for Tag) so the scale stays aligned. Not used yet, but keeps the primitives in sync.

### 3. Use `pico` in all three bottom navs
`src/components/{coach,parent,athlete}/bottom-nav.tsx`:
- Change `<Eyebrow size="nano" …>` → `<Eyebrow size="pico" …>`.
- No other spacing/icon changes.

## Verification

- Preview `/coach/roster`, `/parent/plans`, `/athlete/plans` on 390px: labels visibly smaller, no clipping.
- `rg 'text-pico|size="pico"' src` → shows the new utility + three nav files.
- Typecheck clean.

## Out of scope

- Icon sizes stay at 18px (per prior turn).
- No changes to other Eyebrow / Chip / Tag call sites.
