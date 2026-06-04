Recolor the page-title highlighter stripe in dark mode to use the existing `--pen-pool-wash` token (calm navy) so the cream text reads cleanly. Light mode keeps the current tennis-green stripe.

## Approach

Introduce one new semantic token, `--page-title-stripe`, that maps per theme. This keeps `PageTitle` agnostic of which pen it's pointing at — easy to retune later without touching the component.

## Changes

**1. `src/styles.css` — add token in both themes**

In `:root` (light):
```css
--page-title-stripe: var(--pen-tennis);   /* unchanged look */
```

In `.dark`:
```css
--page-title-stripe: var(--pen-pool-wash); /* dark navy blue */
```

**2. `src/components/page-title.tsx` — swap the stripe color reference**

Replace the three `var(--pen-tennis)` references inside the gradient with `var(--page-title-stripe)`. Keep the gradient stops (90% → 60% → 25% → transparent), the −2.5° tilt, and all positioning identical.

## Why this scales

- One token, used in one component. Future title-stripe tweaks are a single CSS edit.
- Reuses existing pen-wash system — no off-palette colors introduced.
- Logo wordmark stripe is intentionally left on `--pen-tennis` (it's the brand mark, not a page title). If you later want the logo to follow suit, the same token swap applies there.

## Out of scope

- `pen-highlight` utility (used by bottom-nav active labels) — different visual role, not changed.
- Light mode — untouched.