# Fix roster-full upgrade card surface

## Why it looks off

The card at `src/routes/_authenticated/coach.roster.tsx:204` uses the `paper-surface` utility:

```tsx
<div className="paper-surface mt-3 rounded-lg border border-divider p-3">
```

Per our design system memory, `paper-surface` is reserved for **the app background and bottom-sliding Sheets** — surfaces meant to read as "the page itself" (wash gradient + ruled lines + grain). Using it on a small inline card inside a page produces a rectangle that shows a slice of the page wash/ruling — in light mode this reads as a muddy, slightly-off panel that doesn't match sibling cards like `FirstPlanBanner` (which sit on `bg-card` / `bg-elevated`).

It's not a bad color value — it's the wrong surface token for this role.

## Change

In `src/routes/_authenticated/coach.roster.tsx` line 204, replace `paper-surface` with `bg-elevated` so the card reads as a distinct notebook card on top of the page, consistent with other inline banners:

```tsx
<div className="mt-3 rounded-lg border border-divider bg-elevated p-3">
```

No other changes — border, spacing, typography, and the nested `UpgradeToProRow` stay as-is.
