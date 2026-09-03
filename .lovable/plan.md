# See the post-event linking prompt as Tami Taylor

## What you'll see

On **Coach → Roster**, a small card appears at the top of the page:

```text
GRADUS DEMO INVITATIONAL HAS ENDED
Did any of your athletes compete at Gradus Demo Invitational?
[ Yes, link athletes ]   [ No ]
```

"Yes, link athletes" opens a bottom sheet listing your rostered athletes; picking
one shows likely name matches from the event's published skater list (Jamie
Gilmore, Mia Okonkwo, Leon Gillespie) so you can confirm the link. Confirming
pulls in that skater's results and protocols. "No" permanently dismisses the ask
for that event.

## Why it isn't showing right now

The prompt is driven by a coach *attendance* record: it only appears for a coach
who opened that event's live board, once the event's end date has passed and
within seven days of it. The seeded `Gradus Demo Invitational` (ended
2026-09-01) currently has exactly one attendance row, and it belongs to the
parent test account — there is no coach attendance row for Tami Taylor, so she
has nothing to be asked about.

## What I'll do

1. Insert a coach attendance record for Tami Taylor on `Gradus Demo
   Invitational` (`viewer_role = 'coach'`, not dismissed, seen during the
   event) — the same row the app writes when a coach opens a live board.
2. Confirm none of her seven rostered athletes are already linked to that
   event, so the prompt opens in the "nothing linked yet" state.
3. Verify in the preview that the card renders on `/coach/roster` and that the
   link sheet lists her roster and surfaces the board's skater matches.

## Technical notes

- Data-only change to `competition_attendance`; no schema, code, or UI edits.
- Re-triggering later just means clearing `dismissed_at` on that row.
