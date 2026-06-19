# Add Skiing sport

## 1. `src/lib/coach-sports.ts`
- Add `"skiing"` to `SportKey` union.
- Append `skiing` entry. `label: "Skiing"`, `standard: ""`. 5 levels matching Dance/Equestrian:
  - Beginner (2), Advanced Beginner (4), Intermediate (6), Advanced (10), Pre-Professional (16)

## 2. Move library (28 rows → `public.seed_moves`, `sport='skiing'`)

**Category normalization** (5 buckets, Moguls merged into Terrain):
- Alpine Fundamentals
- Terrain (incl. moguls, powder, steep)
- Race
- Freestyle & Park
- Backcountry / Touring

**Source → normalized mapping**:
- "Alpine Fundamentals" → Alpine Fundamentals
- "Technique" → Alpine Fundamentals (wedge christie, jump turn)
- "Terrain" → Terrain
- "Moguls" → Terrain (compression turn)
- "Race Technique" / "Alpine Racing" → Race
- "Freestyle / Air" / "Freestyle" / "Park" → Freestyle & Park
- "Backcountry / Touring" → Backcountry / Touring

**20 complete rows** inserted verbatim with mapping above.

**8 gap rows filled** (standard ski references):

| Move | Kind | Target | Category |
|---|---|---|---|
| Wedge christie | reps | 8 | Alpine Fundamentals |
| Switch skiing | reps | 6 | Freestyle & Park |
| Aerial jump | reps | 4 | Freestyle & Park |
| Rail slide | reps | 6 | Freestyle & Park |
| Downhill tuck | mins | 5 | Race |
| Jump turn | reps | 6 | Alpine Fundamentals |
| Compression turn | reps | 8 | Terrain |
| Super-G turn shape | reps | 6 | Race |

Each gets a 2–3 sentence description, short cue, and one-line why grounded in standard alpine coaching.

## 3. Seed insert
Single SQL INSERT via supabase--insert. `default_target_kind` per source (mins for sustained efforts like skinning/tuck, reps for everything else).

## 4. No other code changes
Sport-key validator accepts arbitrary slugs; onboarding pre-populates automatically.
