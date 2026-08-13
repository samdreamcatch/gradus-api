# Fix: new coaches get an empty move library

## What's actually happening

Confirmed against the live database and production logs, not guessed:

- The new coach (Alyson, figure skating) has 5 figure-skating levels saved and **0** moves.
- Every seeding attempt failed, nine times, with the same database error:
  `record "new" has no field "source"` — logged at signup and on each library visit.
- The starter catalog is fine (238 figure-skating moves) and the seeding routine itself is fine.

The culprit is a shared validation rule attached to both the plans table and the moves table. It was extended for Gradus starter plans with a check on a `source` field. Plans have that field; moves do not. Even though the check is only meant to apply to plans, the database resolves the whole condition before deciding, so **every insert into the moves table now fails** — starter seeding and, importantly, a coach manually creating a new move.

This is not specific to figure skating or to this coach; it affects all coaches created since that rule changed. The earlier golf coach has moves only because they were seeded before it.

## The fix

1. Rewrite the shared validation rule so the `source` check is only evaluated for plans — a nested check per table instead of one combined condition. No behavior change for plans or org templates.
2. Backfill: run the (idempotent) starter seeding for every coach who has sports configured but is missing starter moves for one or more of those sports. This restores Alyson's 238 figure-skating moves and repairs anyone else hit by the same window.
3. Verify: re-query move counts per affected coach after the backfill, and confirm a manual "new move" insert succeeds.

## Technical notes

- `public.validate_org_template_ownership()` — the `ELSE` branch's
  `NOT (TG_TABLE_NAME = 'plans' AND NEW.source = 'gradus')` is not short-circuited in plpgsql; split into `IF TG_TABLE_NAME = 'plans' THEN ... ELSIF TG_TABLE_NAME = 'moves' THEN ...`.
- Backfill via SQL that mirrors `seed_coach_library`'s insert (the function's `auth.uid()` check makes it unusable from a migration), scoped to coaches with `coach_levels` rows and guarded by the same `NOT EXISTS` name check.
- No app code change required; error logging already added to `listMoves` and `saveCoachLevels` is what surfaced this.
