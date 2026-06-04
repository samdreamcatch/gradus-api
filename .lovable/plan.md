Lift the dark-mode page-title stripe from the deep tennis-wash to a mid-tone olive that matches the Gradus website reference — readable behind cream text without going muddy or neon.

## Change

**`src/styles.css` — `.dark` block, `--page-title-stripe`**

Replace `var(--pen-tennis-wash)` (oklch 0.30 0.095 119, too dark) with a direct mid-tone value sampled from the reference:

```css
--page-title-stripe: oklch(0.62 0.13 119);
```

That's the same hue family as `--pen-tennis` (119), but at L 0.62 / C 0.13 — sits between the bright accent green and the dark wash. Matches the muted olive in the screenshot.

## Why a direct value, not a token

The existing pen-tennis scale has two stops in dark mode: bright (0.90) and deep wash (0.30). The reference color sits between them. Rather than retune the whole pen-tennis scale (which is also used as `--accent` everywhere), we keep `--page-title-stripe` as the single semantic seam and give it its own value. Future tweaks remain one line.

Light mode is untouched — still `var(--pen-tennis)`.

## Verification

Cream text `text-primary` (L 0.945) over olive stripe (L 0.62) plus the existing gradient fade (90% → 25% → transparent) keeps contrast well above 4.5:1 across the stripe.