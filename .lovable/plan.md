# Remove "Add an athlete manually"

The manual path created a coach-only athlete record with no way for an 18+ athlete to ever claim it. Since a coach's invite code now works for an athlete of any age, the drawer drops to two clear ways in.

## What changes

- The "Add athlete" drawer keeps two rows: **Share your code** and **Enter their code**. The manual row is gone, and the sheet copy changes from "Three ways to connect" to "Two ways to connect."
- No behavior change for athletes already added this way — existing rosters, plans, schedules, and invoices are untouched.

## Technical notes

- `src/routes/_authenticated/coach.roster.tsx`: drop the `manual` entry from `INVITE_STEPS`, remove the `AddYouthAthleteCard` branch and its import, and update the sheet description.
- Delete `src/components/coach/add-youth-athlete-card.tsx` (no other callers).
- Leave the `addAthleteWithGuardian` server function and its database columns in place — unused by the UI, but harmless and useful if manual add returns with a claim link later. No migration.
