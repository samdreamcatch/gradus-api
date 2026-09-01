## Technical notes

Single file: `src/components/board/schedule-board.tsx`.

- Time span: `w-14 ... text-sm` becomes a narrower column at the smaller mono
  size used elsewhere on the board; keep `tabular-nums`.
- Title span: drop `truncate`, allow wrapping (`leading-snug`); row switches
  from `items-center` to `items-start` so the tag stays aligned to the top line.
- Meta line: `[e.rink, count]` becomes `e.rink` only; screen-reader label keeps
  the count so nothing is lost for assistive tech.
- Header row labels and the status column width stay as they are.

No data, routing, or business-logic changes.
