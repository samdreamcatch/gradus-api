## What I'd change

All changes are presentational and confined to the board files. No new
components, no new colors, no logic changes.

`src/routes/board.$slug.tsx`
- Wrap the two view chips in `role="tablist"`; each chip gets `role="tab"`,
  `aria-selected`, and `aria-controls`; the panel below gets `role="tabpanel"`.
- Add a visually-hidden polite live region that renders a short sentence when
  `changed` fires — e.g. "Nora Donaldson is on the ice, Rink A" — so score and
  lane movement is announced, matching the on-screen flash.
- Rink chips get `aria-pressed` and, when live, a visually-hidden "live" word
  next to the bullet.
- The loading skeleton block gets `role="status"` + `aria-busy="true"` with a
  visually-hidden "Loading the live board".

`src/components/board/my-skaters.tsx`
- "YOUR SKATERS" Eyebrow becomes an `<h2>` styled the same way.
- Each skater block gets an `<h3>` for the name (styling unchanged).
- Follow chip gets `aria-pressed`; the three action chips move from
  `size="caption"` to `size="small"` with `min-h-11` so they clear 44px.

`src/components/board/schedule-board.tsx`
- Column header row becomes `aria-hidden` (it labels nothing on its own).
- Each row button gets a composed `aria-label`: time, event and segment, status,
  rink, and "your skater" when it applies.
- Rows get `min-h-11`.

`src/components/board/rink-panel.tsx`
- The tappable lane already carries text; add `aria-label` naming the skater and
  that it opens the score detail, so "score detail ›" isn't the whole name.

`src/components/board/score-sheet.tsx`
- Element/component rows are a table of numbers rendered as divs; give the
  element list `role="table"` semantics via the existing `Table` primitive, or
  at minimum add column headers so "8.25 1.20 9.45" isn't read as a bare run of
  numbers.

## Not changing

- Colors: the audit found no violations.
- Nano text sizing: flagged as info only; I'd leave the type scale alone unless
  you want the smallest counters bumped one step.
