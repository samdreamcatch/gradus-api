## Add "Strength & Conditioning" sport + move library

### 1. Register the sport
Edit `src/lib/coach-sports.ts`:
- Add `"strength_conditioning"` to `SportKey`.
- Append to `SPORTS`:
  - key: `strength_conditioning`
  - label: `Strength & Conditioning`
  - standard: `""` (no external rating system)
  - levels (purpose-of-training, 5 tiers):
    - `general_fitness` — General fitness (2 hr/wk) — hint: "Health, longevity, no sport goal"
    - `in_season_maintenance` — Sport prep · in-season (3 hr/wk) — hint: "Maintain during competition"
    - `off_season_build` — Sport prep · off-season (5 hr/wk) — hint: "Build strength between seasons"
    - `performance_athlete` — Performance athlete (8 hr/wk) — hint: "Competitive, structured programming"
    - `elite_performance` — Elite performance (12 hr/wk) — hint: "Collegiate / pro / national team"

This automatically wires the sport into onboarding, coach settings, parent goals, athlete signup, and the sport multi-select (all read from `SPORTS`).

### 2. Seed the move library
New migration that `INSERT`s 26 rows into `public.seed_moves` with `sport = 'strength_conditioning'`, mapping each provided move to columns:
- `name`, `category` (Cross Training / Weight Lifting / Yoga / Stretching), `description`, `cue`, `why` (empty string where not supplied — Rowing intervals, Sled Pull, Pigeon pose), `default_target_kind` (`reps` or `minutes` per the "Reps/Minutes" column), `default_target_value` (`10` for reps, `1` for minutes — the schema defaults).

Because the existing `seed_coach_library` function copies matching seed_moves into any coach whose `coach_levels.sport` matches, existing S&C coaches (once they add the sport) will receive the library. For coaches who already selected S&C somehow before this seed exists, the migration also runs a one-time backfill:

```sql
INSERT INTO moves (coach_id, sport, category, name, description, cue, why,
                   default_target_kind, default_target_value)
SELECT cp.id, sm.sport, sm.category, sm.name, sm.description, sm.cue, sm.why,
       sm.default_target_kind, sm.default_target_value
FROM coach_profiles cp
JOIN coach_levels cl ON cl.coach_id = cp.id
JOIN seed_moves sm ON sm.sport = 'strength_conditioning'
WHERE lower(replace(cl.sport,' ','_')) = 'strength_conditioning'
  AND NOT EXISTS (
    SELECT 1 FROM moves m
    WHERE m.coach_id = cp.id AND m.sport = sm.sport AND lower(m.name) = lower(sm.name)
  );
```

### 3. Verify
Build passes; open coach onboarding/settings and confirm "Strength & Conditioning" appears with the 5 levels.