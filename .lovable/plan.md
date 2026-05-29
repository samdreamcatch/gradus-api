## Add ruled paper lines to cards + tighten field padding

### 1. Ruled paper lines on card surfaces
In `src/routes/_authenticated/coach.plans.$planId.tsx`, the assignment card (line 221) and each move card (line 286) currently use `rounded-lg border border-divider bg-card p-3` — flat. Replace `bg-card` with a layered background that paints 32px horizontal ruled lines (matching the page's body lines) over the card color:

```
bg-card
bg-[linear-gradient(to_bottom,transparent_31px,color-mix(in_oklab,var(--foreground)_7%,transparent)_31px,color-mix(in_oklab,var(--foreground)_7%,transparent)_32px,transparent_32px)]
bg-[length:100%_32px]
```

This uses the exact same line color/spacing as `body` in `src/styles.css`, so card lines align with the page rhythm.

### 2. Tighter vertical padding on fields
In `src/components/coach/move-field.tsx`, change `py-2` → `py-1.5` in two places:
- Rest-state button (line 103)
- `sharedInputCls` editing state (line 120)

Horizontal padding (`px-3`), border, radius, and hover/edit chrome stay the same. Label spacing stays at `space-y-1.5`.

### Out of scope
No other styling changes. Sheet background, typography, accent color all unchanged.
