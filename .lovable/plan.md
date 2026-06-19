# Add Fencing sport

## 1. `src/lib/coach-sports.ts`
- Add `"fencing"` to `SportKey` union.
- Append `fencing` entry to `SPORTS` with 6 USA Fencing rating levels: **U, E, D, C, B, A** (U = unrated/novice, A = highest). `suggestedHours` scales 2 → 20 across the tiers.

## 2. Move library (25 rows → `public.seed_moves`, `sport='fencing'`)

**Category normalization** (weapon-agnostic buckets):
- Footwork
- Blade Work (merges "Blade Actions" + "Blade Work")
- Attacks (merges "Attack" + "Attacks" + "Sabre Attack" — sabre-specific noted in cue/why)
- Defense
- Tactics (replaces "Competition Strategy")

**20 complete rows** inserted verbatim with the normalized category mapping.

**5 gap rows filled** (standard fencing references):

| Move | Reps | Description | Cue | Why | Category |
|---|---|---|---|---|---|
| Froissement | 12 | Strong grazing action down the opponent's blade that displaces it forcefully off-line, followed immediately by the attack. Maintain blade contact the whole length. | Sweep down the blade and go | More forceful than a beat; physically removes the opposing blade and clears the line in one motion. | Blade Work |
| Remise | 15 | Immediate replacement of the point in the same line after the original attack misses or is parried, without withdrawing the arm. | Don't pull back — replace | Punishes a slow or absent riposte; in épée it scores outright when the opponent doesn't riposte in tempo. | Attacks |
| Patinando | 15 | Advance combined with a sharp appel as the front foot lands. Used to provoke a reaction while closing distance. | Step in with a stamp | Closes distance and draws a parry simultaneously — sets up the real attack on the next tempo. | Footwork |
| Sabre cut | 20 | Cutting action with the edge of the blade to head, flank, or chest. Movement comes from the fingers and wrist, not the whole arm. Edge arrives flat to the target. | Fingers and wrist, flat edge | The primary scoring action in sabre; cuts are faster than thrusts and cover the whole valid target. | Attacks |
| Molinello | 12 | Sabre cut delivered with a full circular motion of the blade, typically to the head or flank after a parry. Wrist leads the circle. | Circle from the wrist | Generates power and disguises the line of the riposte in sabre; bread-and-butter follow-up to parry quinte. | Attacks |

## 3. Seed insert
Single Python script with `NORM` map + dedup `seen` set (same shape as gymnastics). Inserts ~25 rows into `seed_moves` with: `name`, `description`, `cue`, `why`, `category`, `default_target_kind='reps'`, `default_target_value`.

## 4. No other code changes
Sport-key validator accepts arbitrary slugs; onboarding multi-select and hours step pre-populate automatically.
