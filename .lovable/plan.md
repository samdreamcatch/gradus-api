# Fix athlete plans timeout (same root cause as the parent plans one)

## What happened

Aubrie Hayes hit "Something went wrong" 11 times on `/athlete/plans` at 6:36 PM. The underlying database message is `canceling statement due to statement timeout` — the query didn't fail, it ran out of time.

This is the same class of problem that broke the parent plans page yesterday, in the athlete version of the page, which was never given the same fix.

## Why it's slow

The athlete plans page loads plans, then loads the moves and practice sessions for those plans. The moves and sessions queries run through per-row permission checks that re-verify "does this athlete own this plan?" for every single row returned — even though the plan list was already permission-checked one step earlier. On an account with a few Gradus starter programs (each with many moves), that repeated check is enough to blow the time limit.

Two contributing details confirmed in the database:
- The athlete permission rules on moves and sessions re-join back to `plans` and `athletes` per row.
- Several of those rules call the current-user lookup in a form Postgres re-evaluates per row instead of once per query.

## The fix

1. In the athlete plans list and detail loaders, authorize the plan IDs once (as we already do), then read the moves and session rows for those already-authorized IDs with the privileged server client — exactly the pattern parent plans now uses. No change to what data an athlete can see: the plan IDs are still filtered by their own permission-checked query.
2. Update the athlete-facing permission rules on `plan_moves`, `plan_sessions`, and `plans` so the current-user lookup is evaluated once per query rather than per row (wrap in a scalar subselect, matching how the coach and parent rules were already fixed).
3. Confirm supporting indexes exist on `plan_moves.plan_id`, `plan_sessions.plan_id`, and `plans.athlete_id`; add any that are missing.
4. Verify by loading `/athlete/plans` as an athlete account with starter programs and checking the timing.

## How to respond to Aubrie

Nothing is wrong with her account or her data — it was a slow-loading page, not lost work. Suggested reply:

> Sorry about that — that was a loading timeout on our side, not anything wrong with your account. We've got a fix going out shortly; if you refresh after that it should load normally. Nothing you entered was lost.

Once the fix is published, ask her to fully refresh (the app also prompts for updates now).

## Technical notes

- Files: `src/lib/athlete-plans.functions.ts` (both `listAthletePlans` and `getAthletePlan`), plus a migration for the policy rewrites and any missing indexes.
- `loadSessionsByPlanIds` is shared with coach/parent paths; the athlete path will pass a client that can read the already-authorized plan IDs rather than changing shared behavior for other roles.
