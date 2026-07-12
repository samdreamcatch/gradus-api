Swap the textarea fill in `src/components/plans/message-coach-about-plan-dialog.tsx` from the flat `bg-card` to a translucent ink wash that reads the same in both themes.

Change line 95's className:
- Remove: `bg-card`
- Add: `bg-foreground/[0.04] dark:bg-foreground/5`

Rationale: `foreground` flips with the theme, so in light mode it's a ~4% wash of the dark ink over the white dialog (mirrors today's near-white feel) and in dark mode it's a ~5% wash of the pale ink over the popover surface — a soft paper inset that lets the dialog show through instead of a grey slab. Border, focus ring, and text tokens stay as-is.

No other files change.