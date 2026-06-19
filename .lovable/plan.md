# Add Dance Sport Library

Add **Dance** as the 4th built-in sport, with a 5-tier generic level set and 50 seeded moves across Ballet, Jazz, Hip Hop, and Contemporary categories.

## 1. Built-in sport catalog (`src/lib/coach-sports.ts`)

- Extend `SportKey` union: `"tennis" | "golf" | "figure_skating" | "dance"`.
- Append a `dance` entry to `SPORTS`:
  - **label**: "Dance"
  - **standard**: "Generic skill tiers"
  - **levels** (5):
    1. `beginner` — "Beginner"
    2. `advanced_beginner` — "Advanced Beginner"
    3. `intermediate` — "Intermediate"
    4. `advanced` — "Advanced"
    5. `pre_professional` — "Pre-Professional"

## 2. Seed move data (data insert, not schema change)

Insert 50 rows into `public.seed_moves` with `sport = 'dance'`. Each row maps directly from the provided list:

- `name` ← move name
- `category` ← provided category (Barre Work, Center Work, Turns & Pirouettes, Jumps & Leaps, Artistry & Performance, Jazz, Hip Hop, Contemporary)
- `default_target_kind` ← `reps` or `mins`
- `default_target_value` ← provided number
- `description`, `cue`, `why` ← provided text

The existing `seed_coach_library` RPC will pick these up automatically for any coach whose `coach_levels` includes sport `dance` (it matches on normalized sport key).

## 3. No other code changes required

- `coach-profile.functions.ts` already accepts arbitrary sport keys (recently relaxed from enum to regex), so `dance` validates without further edits.
- The onboarding multi-select reads from `SPORTS`, so Dance will appear in the dropdown automatically once step 1 lands.
- Levels step will render the 5-tier checklist from the catalog.

## Technical notes

- Data insert runs via the data-insert tool (not a migration), since `seed_moves` schema is unchanged.
- All 50 rows inserted in a single `INSERT ... VALUES (...), (...), ...` statement.
- Categories are free-form text in `seed_moves`, so no enum updates needed.
