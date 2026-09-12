# Fix live-board competition time zones

## Goal
Show the correct current and next events on each rink, including the Chicagoland events scheduled between now and 4:15 PM.

## Changes
- Read the competition’s published local time-zone label from its IJS page instead of assuming every event uses Eastern Time.
- Convert schedule times using that competition-specific zone when deciding whether an event is live, finished, or next.
- Carry the zone through the board snapshot so displayed clock times and countdowns match the venue.
- Keep the current Live, Schedule, and wall-display layouts unchanged.
- Add focused parser/time conversion tests for Central and Eastern competitions.

## Verification
- Refresh the Chicagoland board and confirm the 2:05 PM and 2:15 PM events appear in the correct current/next state rather than jumping to 4:15 PM.
- Run lint, typecheck, and build checks.
