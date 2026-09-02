# Bigger schedule time + contrast check

The time column on the Schedule tab is currently the smallest text on the
board (9px). Bump it one step so it reads at a glance, and confirm every text
color in that row still clears WCAG AAA.

## What changes

- Time value: 9px to 11px mono, still tabular so columns stay aligned.
- Time column widens slightly (11 to 12 units) so times like "11:54 PM" stay
  on one line; the event title keeps the rest of the row and can still wrap to
  two lines.
- The "TIME" header label above the column matches the new width.

Nothing else moves: the pulsing live dot, the rink line, and the LIVE /
your-skater tags stay exactly as they are.
