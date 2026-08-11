# Fix: library shows only one sport after adding a sport

## What's actually happening

Your coach account (Test Coach) has both figure skating and golf configured, but the move library holds only the 50 golf moves — the 238 figure skating starter moves were never copied in.

Verified against the database:

- Your profile has levels for both `figure_skating` and `golf`.
- Your `moves` rows: golf only, all created July 1. Nothing for figure skating.
- The starter catalog does contain figure skating (238 moves), and the seeding routine, if run now, would insert exactly those 238 rows.

So the catalog and the seeding logic are both fine. The seed only ever runs as a side effect of loading the library screen, and the library data is cached under a single `["moves"]` query key that nothing invalidates when a coach changes their sports. Golf was seeded back when golf was the only sport; after figure skating was added, no library fetch was triggered, so the new sport's moves were never pulled in — and the cached list keeps showing golf-only until a hard reload.

## The fix

1. Refresh the library after sports change. When coach levels/sports are saved (onboarding and settings), invalidate the `["moves"]` and `["coach-sports"]` caches so the next library visit re-runs seeding and picks up the new sport.
2. Don't rely on cache timing for seeding. Have the sports-save path trigger the library seed directly (server-side, right after levels are written) so a coach's moves match their sports as soon as they save, regardless of what screen they visit next.
3. Surface failures instead of swallowing them. The library currently ignores any error from the seeding call; log/report it so a silent partial library can't happen again unnoticed.
4. Backfill your account. Loading the library after fix #1/#2 will insert the missing 238 figure skating moves for this coach (seeding is idempotent — no duplicates for golf).

## Technical notes

- `src/lib/moves.functions.ts` → `listMoves` calls `rpc("seed_coach_library")` and discards its error; add error handling.
- `src/lib/coach-profile.functions.ts` → `saveCoachLevels` should call the same seed RPC after replacing `coach_levels`.
- `src/hooks/use-coach-profile.ts` → `useSaveCoachLevels.onSuccess` should also invalidate `["moves"]` and `["coach-sports"]`.
- No schema change; `seed_coach_library` and `seed_moves` are already correct.
