# Align coach sport-filter chips with the shared Chip system

## Problem

`src/components/coach/sport-filter-chips.tsx` overrides the `Chip` primitive's defaults (`size="caption" weight="bold" tracking="widest"` on the filter row, `size="micro" weight="bold" tracking="widest"` on the single-sport case), and uppercases the labels. Every other sport picker in the app (`parent.settings.tsx` sport toggles, `add-coach-by-code-card.tsx`, `onboarding/sport-chip.tsx`) uses `Chip` at its defaults with `caseSensitive`, producing rounded pills at `text-xs` / `semibold` / `tracking-wider` in mixed case. The coach roster filter reads visually as a different vocabulary.

## Fix

`src/components/coach/sport-filter-chips.tsx`:

1. **Multi-sport filter row** — render each option as:
   ```tsx
   <Chip
     key={opt.key ?? "__all"}
     caseSensitive
     tone="muted"
     selected={isActive}
     onClick={() => onSelect(opt.key)}
   >
     {opt.label}
   </Chip>
   ```
   Drop the `as="button"` (implicit from `onClick`), `size`, `weight`, `tracking` overrides. Keep `tone="muted"` for the unselected pills so "All" reads as a filter, not a CTA.

2. **Single-sport case** — this is a static label, not an interactive chip. Swap to `<Tag>` (the primitive built for exactly this):
   ```tsx
   <Tag tone="accent" caseSensitive>{sportLabel(sports[0])}</Tag>
   ```
   Removes the `text-accent-ink` className hack and the mismatched `micro/bold/widest` triple.

3. Import `Tag` alongside `Chip`; leave the wrapper `<div className="mt-4 …">` and the empty-array early return untouched.

## Verification

- Preview `/coach/roster` on 390px: filter chips read as mixed-case rounded pills matching the parent sport toggles; single-sport case shows a small accent tag.
- `rg 'tracking-widest|size="caption"|size="micro"' src/components/coach/sport-filter-chips.tsx` → no matches.
- Typecheck clean.

## Out of scope

- No changes to `Chip` / `Tag` primitives themselves — this is a call-site alignment.
- No changes to other sport pickers; they already match the target.
