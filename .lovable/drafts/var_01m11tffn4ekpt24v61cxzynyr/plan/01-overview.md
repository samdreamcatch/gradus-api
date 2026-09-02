# Why adding a competition errors

The Live Board admin screen is complete, but the two database tables it writes to — the competition list and the cached scoreboard snapshot — do not exist in the live backend yet. I confirmed this by querying the database: neither table is present.

They are staged as a pending change inside this draft. Draft changes to the database structure are only applied when the draft is accepted, so right now every "Add competition" click reads the event fine, then fails the moment it tries to save.

## What to do

1. Accept this draft. That applies the staged tables, grants, and public-read policies.
2. Re-try adding the event (for example IJS id `36666`) from Admin → Competitions.
3. If it still errors after that, the failure is in the results fetch rather than storage, and I will capture the exact message and fix that next.

No code changes are needed for step 1 — the admin page, scraper, refresh job, QR code, and public `/board/<slug>` route are already built and wired to these tables.
