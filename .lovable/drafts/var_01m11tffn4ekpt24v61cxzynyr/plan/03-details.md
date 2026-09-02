## Contrast check (AAA)

AAA asks for 7:1 on normal-size text. The three colors used in a schedule row
are the shared design tokens, and their definitions already carry AAA notes:

- Time and secondary text use the secondary ink token, documented at roughly
  7.2:1 on the page background in light mode; dark mode uses the lifted cream
  ramp, which clears the same bar on card surfaces.
- The rink line uses the tertiary ink token, defined to hold AAA at any size
  in both themes.
- The event title uses primary ink, the highest-contrast pairing in the
  system.

Because the time is getting larger rather than smaller, this change can only
improve legibility; no token is being swapped. After the edit I will verify
the rendered colors against the card surface in both light and dark mode and
report the measured ratios. If any pairing lands under 7:1, the fix is to move
that text from tertiary to secondary ink — not to introduce a new color.

## Technical notes

Single file: `src/components/board/schedule-board.tsx`.

- Time span: `text-nano` becomes `text-caption`; `w-11` becomes `w-12`; keeps
  `font-mono tabular-nums` and the live-dot flex layout.
- Header row: the "Time" label span width matches `w-12`.

No data, routing, or business-logic changes.
