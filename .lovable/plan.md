# Roster cap during schedule import

## What happens today

Nothing in the import flow knows about the 5-athlete cap on the basic Coach plan.

- The cap is enforced only by a database rule that fires when an athlete is attached to a coach. It stops the 6th athlete with the message: "Roster full: the coach plan is limited to 5 athletes. Upgrade to add more."
- The import commits athlete by athlete. So a coach importing 12 new athletes gets the first few in (up to the cap), and every remaining athlete comes back as a red "failed" row with that raw database sentence as the reason. No orphan records are left behind, and lessons for athletes already on the roster still get added.
- The "Import my schedule" entry point is not disabled when the roster is full (unlike "Add athlete", which is), so a full-roster coach can walk the whole flow and only find out at the very end that nothing new could be created.
- Club coaches are uncapped; Coach Pro is 50. Note: founding coaches are treated as basic "coach" (cap 5) by the database rule unless their tier is actually set to coach_pro.

## Proposed handling

Make the limit visible before the coach does the work, and make the outcome legible after.

1. **Before import (review/confirm step)** — show a line such as "You have room for 3 more athletes on the Coach plan (5 max)". If the import would create more new athletes than the remaining room, show a warning with two choices: import the ones that fit now, or upgrade first (link to `/coach/paywall`).
2. **Selection instead of silent truncation** — when over the cap, the confirm step marks which new athletes are over the line and lets the coach reorder/deselect so they decide who makes the cut, rather than the import deciding by row order.
3. **Server-side guard** — `commitScheduleImport` reads the coach's tier and current roster count up front, imports up to the remaining room, and marks the rest as `skipped` (a new outcome status) with the reason "Roster limit reached", instead of letting each one fail with a raw database error. Athletes already on the roster are never blocked; their lessons import normally.
4. **Results screen** — group outcomes into "Imported", "Lessons added to existing athletes", and "Skipped — roster full", with a single Upgrade button under the skipped group instead of one raw error per row.
5. **Entry point** — keep "Import my schedule" enabled even when the roster is full (a full-roster coach can still add lessons to existing athletes), but show the remaining-room line at the top of the sheet.

## Technical notes

- Reuse `athleteLimitForTier` and the existing `isRosterFullError` / `coachRosterFullCopy` helpers; no new limit constants.
- `ImportOutcome.status` gains `"skipped"`; the sheet's results rendering branches on it.
- Remaining room = limit − current `coach_athletes` count for the coach, computed inside the server function (the client value is advisory only).
- No schema migration; the database rule stays as the backstop.
