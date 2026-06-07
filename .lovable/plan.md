# Replace near-black text with navy in dark mode

## What's actually black

I audited the codebase. There is **no `text-black`, `text-[#000]`, or hard-coded black color** anywhere in components. Every `font-black` match is a font *weight*, not a color, and every `bg-black/80` / `ring-black/10` is a backdrop or hairline ring (not text).

The text that *looks* black in dark mode comes from exactly two design tokens in `src/styles.css` under `.dark`:

```css
--accent-foreground:    oklch(0.18 0.012 245);  /* text on tennis-green buttons/pills */
--attention-foreground: oklch(0.18 0.012 245);  /* text on bright orange chips */
```

Lightness 0.18 + chroma 0.012 = effectively black with a sliver of blue. That's what you're seeing on:
- Primary buttons (`bg-accent text-accent-foreground`)
- Coach plan pills, "Tap to start" chips, voice-FAB
- Unread message badges (`bg-attention text-attention-foreground`)
- ✓ check glyphs inside accent selections

Nothing else in `.dark` resolves to a near-black text color — `--foreground`, `--text-primary/secondary/tertiary` are all the cream/parchment family, and every `--pen-*-ink` in dark mode is a bright tint.

## The change

Introduce one navy ink in the `.dark` block and point both foreground tokens at it. Navy has to keep enough contrast against the bright tennis green and bright orange backgrounds (WCAG ≥ 4.5:1 body / ≥ 3:1 for large UI text).

```css
.dark {
  /* Navy ink — replaces the near-black used on bright accent/attention surfaces */
  --ink-navy: oklch(0.22 0.09 255);

  --accent-foreground:    var(--ink-navy);
  --attention-foreground: var(--ink-navy);
}
```

Light mode is **not** touched — the analogous tokens there are warm tinted inks (`--pen-tennis-ink`, `oklch(0.22 0.06 55)`), not black.

## Scope guard

- File touched: `src/styles.css` only, inside the `.dark` block.
- No component changes — all 65 `text-accent-foreground` / `text-attention-foreground` / `text-primary-foreground` usages pick up the new color automatically.
- `ring-black/10` and `bg-black/80` overlays are intentionally left alone — the user asked about *text*, and these are non-text affordances that read fine in both themes.

## Verification

1. Toggle to dark mode and confirm: primary buttons, the message unread badge, plan pills, voice-FAB label, and the selected-checkmark all show navy text (still legible on bright tennis/orange).
2. Quick contrast spot-check on `text-accent-foreground` over `bg-accent` (tennis green in dark) and `text-attention-foreground` over `bg-attention` (orange in dark).
3. Light mode unchanged.
