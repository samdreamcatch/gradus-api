## What the demo shows

A single day at a three-rink competition, timed relative to when you open it so the
countdowns are always sensible:

- **A Rink — live.** Intermediate Ladies Free Skate, 24 skaters, 7 done.
  `JUST SCORED` a skater with a total, `ON THE ICE` the next name, `UP NEXT` the one
  after. Start order populated so the my-skater card has something to match.
- **B Rink — idle.** Last event just finished with a winner; next event counting down
  in about 20 minutes.
- **C Rink — live, awaiting score.** Event underway with nothing posted yet, so the
  "awaiting score" state is visible.

`/board` also lists the demo under "Happening now" so you can reach it without typing
a URL.

## My-skater card

The pinned card only appears for signed-in users whose athlete name matches the start
order. To make it viewable, the demo start order includes the athlete names on your
own dev account, so signing in as the parent test account surfaces the card and its
"Is this your skater?" prompt.

## Technical notes

- New file `src/lib/board-demo.ts` — browser-safe, exports `DEMO_SLUG = "demo"` and
  `buildDemoBoard(): BoardResponse`, building the payload from `Date.now()` offsets so
  times stay fresh.
- `getBoard` in `src/lib/board.functions.ts` returns `buildDemoBoard()` immediately
  when the slug is `demo`, before any database or scraper call.
- `listBoards` prepends the demo entry so `/board` links to it.
- No route, component, styling, or schema change. Removing the demo later is deleting
  one file and two short branches.
