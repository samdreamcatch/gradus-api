## Why the sheet looks transparent

In `src/styles.css`, the `--card` token is intentionally translucent:

```
--card: oklch(1 0 0 / 0.55);  /* light */
--card: oklch(0.27 0.02 260 / 0.55);  /* dark */
```

This is by design so paper grain / ruled lines show through cards on the page. Every previous attempt (`bg-card`, inline `var(--card)`, `[background-image:none]`) inherited that 55% alpha, which is why the library list bleeds through.

The design system already ships a solid counterpart — `--popover` (oklch 1 0 0 in light, 0.27 0.02 260 in dark) — meant exactly for floating surfaces like menus and sheets.

## Change

In `src/components/coach/move-sheet.tsx`, swap the inline background on `SheetContent` from `var(--card)` to `var(--popover)`. Keep `backgroundImage: 'none'` and the `shadow-page` / border classes.

That's the only change. No token edits, no other components touched.
