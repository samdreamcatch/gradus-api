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

## Where it changes

- `src/components/parent/coach-visibility-toggles.tsx` — rewrite `statusLabel`
  to count pairings instead of building sentence lines; remove the per-pair
  detail list rendering. `pairLabel` / `pairLabels` become unused and get
  deleted.
- `src/routes/_authenticated/parent.settings.tsx` — remove the `pairLabels`
  detail `<ul>` under each coach row and its import; keep the single
  `statusLabel` line.

No data, server function, or toggle behavior changes.
