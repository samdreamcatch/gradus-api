## Apply Highlighter Swipe field style

Update `src/components/coach/move-field.tsx` so inline-editable fields visually separate from the card surface using the selected "Highlighter swipe" prototype, with slightly tighter horizontal padding per user direction.

### Rest state (display button)
- Container: `rounded-xl border border-divider px-3 py-2` (was transparent border, `px-2 py-1.5`)
- Hover: `border-accent/40` (replace current `hover:border-divider hover:bg-elevated/60`)
- Label spacing bumped from `space-y-1` to `space-y-1.5` for breathing room above the bordered field

### Editing state (text input, textarea, select, combo)
- `sharedInputCls` becomes: `rounded-xl border-2 border-accent bg-[var(--pen-tennis-wash)] px-3 py-2 text-text-primary` plus a soft `shadow-[0_0_15px_color-mix(in_oklab,var(--accent)_10%,transparent)]` glow
- Drop the focus ring since the 2px accent border + wash already signals focus

### Notes
- Pen-aware wash: `var(--pen-tennis-wash)` is the Tennis pen wash; since `--accent` switches per user pen, follow up later by introducing a generic `--accent-wash` token if/when other pens are wired in. For now Tennis is the only active pen and this matches the prototype exactly.
- No changes outside `move-field.tsx`. All fields (title, athlete, notes, description, cue, why) inherit the new chrome automatically.
- Tokens used (`divider`, `accent`, `pen-tennis-wash`, `text-primary`, `text-tertiary`) are all already defined in `src/styles.css`.
