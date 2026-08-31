# Live Board — one screen, three tabs

Today the board is one long column: header, Now/Full schedule chips, your skaters,
the follow search, rink chips, the rink panel, a sign-in note, and a footer. Almost
everything needs scrolling.

The fix is the segmented tab control already used in plans and the athlete schedule
(`SegmentedToggle`), applied to the whole board — and a much shorter header — so each
tab is a single screenful.

## Three tabs

- **Mine** — your followed skaters, closest to the ice first, plus the "follow anyone"
  search collapsed behind a single "Follow someone else" row rather than an always-open card.
- **Rinks** — the rink chips and the live rink panel (what "Now" is today).
- **Schedule** — the full-day departures board, unchanged.

Default tab: **Mine** when you follow at least one skater in this competition, otherwise
**Rinks**. Tapping a schedule or skater row still jumps to Rinks, as it does now.

## Header shrinks

The header becomes one compact block: logo and LIVE/FINISHED tag on one line, the
competition name on the next at a smaller display size, and dates/location folded into
the same meta line. The "on the ice is inferred…" explainer and the updated-at line
move out of a permanent footer into a small info affordance at the bottom of the Rinks
tab, so it isn't paid for on every tab.

The signed-out "Sign in to see your own skaters" line only shows on the Mine tab.
