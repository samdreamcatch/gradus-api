# Live Board — results and final standings

Today the board only knows about one day: whichever day the competition is on right now.
Once an event finishes, its rows scroll away and there is no way to ask "who won the
Juvenile Free Skate?" This adds the missing half — the results side of the board.

## What you get

1. **A day picker on the Schedule tab.** Chips for every day of the competition, defaulting
   to the current (or next) day. Picking an earlier day shows that day's events, all marked
   FINAL.
2. **Tap any event to see its results.** A sheet opens with the final standings for that
   event: placement, skater, club, segment score(s) and total — ordered 1, 2, 3, not by
   start order. Gold, silver and bronze are marked with a medal tag.
3. **Tap any skater in those standings** to open the score sheet you already have — the full
   judged protocol, element by element.
4. **Combined events read correctly.** Where an event has a short and a free segment, the
   standings show each segment's score plus the overall total, with placement from the
   overall result.

Live events keep behaving exactly as they do now; the same sheet shows the standings so far,
labelled as in progress.

## What this does not change

- No new colors, no new components — the day chips use the existing chip pattern, standings
  use the existing card/table typography, and the results sheet is the same bottom Sheet as
  the protocol view.
- Statuses stay SCHEDULED / LIVE / FINAL.
- Still one shared cached snapshot refreshed every 30 seconds; finished events are fetched
  once and then read from cache, so covering the whole competition does not multiply
  requests to the source.
