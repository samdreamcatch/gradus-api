# Simplify coach visibility status to one line

Today each coach row can show up to three stacked lines: a summary line, plus a
per-pairing detail list when the coach is linked to more than one other coach.
Replace all of that with a single counts line.

## New line format

Counts only, in fixed order, zero categories omitted:

```text
2 accepted · 1 pending
1 declined
3 pending
```

Special cases kept:
- Sharing switch off → `Off`
- Sharing on but no other coach for that athlete → `On — add another coach to connect`

Counting rules per coach pairing:
- accepted = both sides accepted
- declined = either side declined
- pending = everything else

## Tap the line for details

The counts line becomes a tappable button that opens a Popover (anchored,
top-aligned on mobile per the overlay doctrine) listing one row per pairing —
the existing per-pair wording, e.g.:

```text
Connected with Dana
Tami accepted — waiting on Sophia
Alex declined
```

Only tappable when there's at least one pairing; `Off` and
`On — add another coach to connect` stay plain text.

## Where it changes

- `src/components/parent/coach-visibility-toggles.tsx` — rewrite `statusLabel`
  to count pairings; keep `pairLabel` / `pairLabels` (now used only inside the
  popover) and add a small shared `CoachVisibilityStatus` component that renders
  the counts line plus its popover. Replace the inline summary + detail list
  with it.
- `src/routes/_authenticated/parent.settings.tsx` — replace the summary line and
  the `pairLabels` detail `<ul>` with `CoachVisibilityStatus`.

No data, server function, or toggle behavior changes.

