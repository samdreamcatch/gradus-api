# Live Board — color + accessibility audit

## Color audit result: clean

Every board file uses semantic design tokens only. No `text-white`, `bg-black`,
hex values, arbitrary `bg-[...]`, or Tailwind palette colors (`gray-`, `slate-`)
appear anywhere in the board route or its components. Lane tinting uses
`secondary-accent` / `accent` / `attention` with their `-wash` and `-ink`
partners, which is exactly what those tokens exist for. No `hover:` states — the
board uses `press` / `press-soft` per the interaction doctrine.

No color changes needed.

## Accessibility findings

### Critical

1. **Now / Full schedule chips are not a tab set.** They are two plain buttons.
   A screen reader hears "Now, button" with no indication of which view is
   showing or that the two are related.
2. **The board updates every 30 seconds with no announcement.** A blind or
   low-vision viewer never learns that a score posted or that their skater moved
   to ON THE ICE — the whole point of the feature.
3. **Follow / rink chips carry state visually only.** "Following" vs "Follow"
   reads, but the selected rink chip and the selected tab expose no
   `aria-pressed`, so state is conveyed by fill color alone.
4. **The live-rink indicator is a bare `•`.** Screen readers announce the rink
   name plus a stray bullet, not "live".

### Warning

5. **Tap targets below 44px.** `Chip size="caption"` (11px text, `py-1`) is used
   for Follow, Go to rink, and Score detail — roughly 24px tall.
6. **Loading state is silent.** The skeleton block has no `aria-busy` or status
   role, so the wait is invisible to assistive tech.
7. **Section headings are Eyebrows, not headings.** "YOUR SKATERS" and the
   schedule column header are styled text, so heading navigation on the page
   jumps straight from the competition name to the rink name.
8. **Schedule rows read as one long run-on string** — time, event, status tag,
   "YOUR SKATER", rink — with no separation cue.

### Info

9. Nano-size text (9–10px) on status tags and "of N" counters is below
   comfortable reading size at rink lighting; bumping the smallest ones one step
   costs nothing structurally.
