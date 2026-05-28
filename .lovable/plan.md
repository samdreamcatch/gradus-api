## Diagnosis

The Library view already does what you described:
- Empty search → returns the full list (`if (!q) return true`)
- Results are grouped by `category` and sorted alphabetically

The reason you're seeing **"No moves match."** is that there are **0 rows in `moves` for your coach** (the DB has 158 `seed_moves` ready, but `seed_coach_library()` was never called for the existing coaches). So the library renders nothing regardless of the search box.

## Plan

### 1. Auto-seed each coach's library on first read
In `src/lib/moves.functions.ts`, inside `listMoves` (server fn):
- After resolving the coach id, if the coach has zero non-archived moves, call the existing `seed_coach_library(_coach_id)` RPC, then re-query.
- This is idempotent — the RPC already early-returns if the coach has any moves.

Why here vs. onboarding: catches existing coaches (you, currently) without a manual backfill, and survives a coach adding a new sport later (we'll also re-run the RPC when `coach_levels` changes — see step 2).

### 2. Re-seed when sports change
Already covered by the RPC's WHERE clause (it only inserts moves whose sport matches a `coach_levels` row). We'll call it again from the existing "update levels" server fn after a successful upsert, so adding a new sport pulls in its seed moves.

### 3. Backfill existing coaches now
One-shot SQL to call `seed_coach_library()` for every coach who currently has zero moves, so you see the library immediately without waiting for the auto-seed path.

### 4. Sharper empty states in `LibraryView`
Distinguish two cases:
- Library is genuinely empty (no moves for this coach) → "Your library is empty. Add a move with +" with a hint that seed moves are loading.
- Library has moves but the query/sport filter excludes everything → keep "No moves match."

### 5. Make the heading match the convention
Library category headers currently use `text-base` bold display. Keep grouping + sort by category as today (already correct) — no change beyond what's above.

## Files touched

- `src/lib/moves.functions.ts` — add seed-on-empty check inside `listMoves`.
- `src/lib/coach-profile.functions.ts` (or wherever the levels upsert lives) — call `seed_coach_library` after a successful levels save.
- `src/routes/_authenticated/coach.plans.tsx` — split the empty state in `LibraryView`.
- One-shot SQL backfill via the data tool to seed existing coaches.

## Out of scope

- Changing the search behavior or sort order (already matches your spec).
- Editing or adding seed moves themselves.
- The Plans tab.
