Codify the "paper" background used by the plan editor sheet into the design system, then apply it to every bottom-sliding sheet.

## 1. Add a `paper-surface` utility to `src/styles.css`

New `@utility paper-surface` (top level, alongside `press`/`press-soft`) that stacks the three layers currently inlined on the plan editor:

```css
@utility paper-surface {
  background-color: var(--background);
  background-image:
    radial-gradient(1200px 800px at 100% 0%, color-mix(in oklab, var(--pen-pool) 18%, transparent), transparent 60%),
    radial-gradient(1000px 700px at 0% 100%, color-mix(in oklab, var(--pen-tennis) 16%, transparent), transparent 60%),
    repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 32px);
}
```

Both wash colors (`--pen-pool`, `--pen-tennis`) and the rule ink (`--foreground`) already swap per theme, so it works in light and dark without extra rules. Because it sets `background-color`, it overrides Sheet's default `bg-popover` when composed.

## 2. Apply it to every bottom-sliding sheet

Replace each surface's default popover background with `paper-surface`. In every case, add `className="paper-surface …"` and drop the inline `style={{ backgroundColor, backgroundImage }}` block if present. Keep any layout/style props that aren't background-related (e.g. keyboard-inset `bottom`, `maxHeight`).

Files to update:
- `src/routes/_authenticated/coach.plans.$planId.tsx` — main editor SheetContent (line ~109, remove inline `style` gradients) AND the "Add moves / New move" SheetContent at line ~1327 (add class alongside existing `flex flex-col`; keep the `bottom`/`maxHeight` style).
- `src/components/coach/athlete-detail-sheet.tsx` — bottom SheetContent.
- `src/components/coach/lesson-slot-sheet.tsx` — bottom SheetContent.
- `src/components/coach/move-sheet.tsx` — bottom SheetContent.
- `src/routes/_authenticated/parent.resources.index.tsx` — bottom SheetContent.

`src/components/ui/drawer.tsx` (Vaul) isn't currently used, so it stays untouched — if it's added later it should also get `paper-surface`.

## 3. Update memory

Extend `mem://index.md` Core with a one-liner: "Bottom-sliding sheets use `paper-surface` utility (page-consistent wash + rules), not the default `bg-popover`."

## Out of scope

- Side sheets (right/left) — the doctrine here is specific to bottom sheets that read as "a page sliding up over the page."
- Dialogs / popovers / dropdowns — those remain opaque `bg-popover` for readability over arbitrary page content.
- Restyling the plan editor's second surface — only its background.

## Verification

- `bunx tsgo --noEmit` clean.
- Visually confirm at 390px: plan editor sheet looks unchanged; the four other bottom sheets now share the same wash + ruled paper look instead of a flat popover.