Fix `paper-surface` to match the app body's dark-mode recipe in `src/styles.css`.

Today the utility hard-codes only the light-mode gradients, so in dark mode the sheet gets a too-intense light-mode wash on a dark base plus rules that are ~2× too strong. The body handles this with a separate `.dark body` block; the utility must too.

Change: keep the current light recipe as the base, and add a dark override inside the utility using the project's existing `dark` custom variant. Also swap `--pen-tennis` → `--accent` to mirror the body (so it respects the user's current pen).

Final shape:

```css
@utility paper-surface {
  background-color: var(--background);
  background-image:
    radial-gradient(1200px 800px at 100% 0%, color-mix(in oklab, var(--pen-pool) 34%, transparent), transparent 60%),
    radial-gradient(1000px 700px at 0% 100%, color-mix(in oklab, var(--accent) 28%, transparent), transparent 60%),
    repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 31px, color-mix(in oklab, var(--foreground) 7%, transparent) 32px);

  &:where(.dark, .dark *) {
    background-image:
      radial-gradient(1800px 1300px at 70% 30%, color-mix(in oklab, var(--pen-pool) 18%, transparent), transparent 70%),
      radial-gradient(600px 500px at 5% 100%, color-mix(in oklab, var(--accent) 10%, transparent), transparent 55%),
      repeating-linear-gradient(to bottom, transparent 0px, transparent 31px, color-mix(in oklab, var(--foreground) 3%, transparent) 31px, color-mix(in oklab, var(--foreground) 3%, transparent) 32px);
  }
}
```

(Also bumps the light recipe's wash opacity from 18/16% → 34/28% so it matches the body page exactly — the whole point of the utility is that the sheet reads as the same paper as the page.)

No other files change.