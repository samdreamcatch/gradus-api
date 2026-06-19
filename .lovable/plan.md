# Add Wrestling sport

## 1. `src/lib/coach-sports.ts`
- Add `"wrestling"` to `SportKey` union.
- Append `wrestling` entry. `label: "Wrestling"`, `standard: "USA Wrestling"`. 5 levels with `suggestedHours`:
  - Beginner (3), Folkstyle Club (6), State Qualifier (12), National Qualifier (18), All-American (22)

## 2. Move library (26 rows → `public.seed_moves`, `sport='wrestling'`)

**Category normalization** (6 position-based buckets, pins separate):
- Stance & Movement
- Takedowns
- Defense
- Pinning Combinations
- Top Position (rides/turns that aren't direct pin attempts)
- Bottom Position (escapes/reversals)

**Source → normalized category mapping**:
- "Stance & Movement" → Stance & Movement
- "Takedowns" → Takedowns
- "Offense" → Takedowns (ankle pick/low single, front headlock, duck under)
- "Defense" → Defense
- "Pinning Combinations" → Pinning Combinations
- "Top Position" → Top Position (Peterson roll, short offense)
- "Bottom Position" → Bottom Position
- "Bottom / Escapes" → Bottom Position (elbow pass)

**20 complete rows** inserted verbatim with mapping above.

**6 gap rows filled** (standard wrestling references):

| Move | Kind | Target | Category |
|---|---|---|---|
| Elbow pass | reps | 12 | Bottom Position |
| Ankle pick / low single | reps | 12 | Takedowns |
| Peterson roll | reps | 8 | Top Position |
| Front headlock | reps | 12 | Takedowns |
| Duck under | reps | 10 | Takedowns |
| Short offense (referee's position) | reps | 10 | Top Position |

Each gets a 2–3 sentence description, short cue, and one-line why grounded in standard folkstyle coaching.

## 3. Seed insert
Single SQL INSERT via supabase--insert. All `default_target_kind='reps'` per source.

## 4. No other code changes
Sport-key validator accepts arbitrary slugs; onboarding pre-populates automatically.
