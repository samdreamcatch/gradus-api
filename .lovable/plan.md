## What's happening today

Each move card in the voice-built plan editor renders its header row as a `<button>` that gets the `pen-highlight` utility applied to the **entire row** whenever the move is newly extracted from voice or has unacknowledged voice changes (`src/routes/_authenticated/coach.plans.$planId.tsx`, lines ~615–641).

`pen-highlight` is a linear-gradient stripe that sits behind text (the 55–92% band). When applied to a full button row that also has horizontal padding and a chevron, the stripe becomes a chunky horizontal green bar pinned to the top edge of the card — especially loud when the card is expanded, because the bar visually disconnects from the content below it.

Per the design system, the pen is meant to feel like a highlighter marking a **word or phrase**, not a full-bleed block. The current usage breaks that rule.

## Proposed fix (design-system aligned)

1. **Scope `pen-highlight` to the move name only**, not the whole header row. The stripe will now sit behind the move title text (e.g. "Single salchow"), which is exactly the "jelly pen highlighter on text" usage the system calls for. The rep count and chevron stay clean.
2. **Drop the row-level highlight when the card is expanded.** Once the coach opens the card, the existing `border-accent` already signals focus; the inner "From your voice" caveats inside each field already mark voice-derived content. Keeping the title highlight only when the card is collapsed gives the coach a glanceable "this came from voice / has unreviewed voice edits" cue in the list view without screaming inside the open editor.
3. **Keep the `ring-2 ring-accent/40` halo on brand-new moves** — that's already a good system-aligned "just added" cue and lives on the card, not as a bar.

### Result

- Collapsed voice-derived card: title text wears a tidy pen-highlight underline-band; rest of the row is calm.
- Expanded card: accent border + per-field "From your voice" annotations carry the meaning; no green bar across the top.
- No new tokens, no new components — just correcting where an existing utility is applied.

## Files touched

- `src/routes/_authenticated/coach.plans.$planId.tsx` — move the `pen-highlight` class from the header `<button>` onto the `<span>` wrapping `{m.name}`, and gate it on `!expanded` (still driven by `isNewMove || touched.moves[m.id]?.length`).

No other files need to change. No backend, no token, no schema work.
