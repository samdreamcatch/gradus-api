# Add Equestrian sport

## 1. `src/lib/coach-sports.ts`
- Add `"equestrian"` to `SportKey` union.
- Append `equestrian` entry to `SPORTS` with 5 levels (Beginner, Advanced Beginner, Intermediate, Advanced, Pre-Professional) matching the Dance shape. `suggestedHours`: 2, 4, 6, 10, 16. `standard: ""`.

## 2. Move library (26 rows → `public.seed_moves`, `sport='equestrian'`)

**Category normalization** (discipline-agnostic buckets):
- Position & Seat
- Flatwork
- Transitions
- Lateral Work
- Dressage
- Jumping

**20 complete rows** inserted verbatim with the categories already in the source.

**6 gap rows filled** (standard dressage references):

| Move | Kind | Target | Description | Cue | Why | Category |
|---|---|---|---|---|---|---|
| Passage | mins | 3 | A highly cadenced, elevated trot with prolonged moments of suspension. The horse appears to trot in slow motion, lifting each diagonal pair high and holding it. | Up and slow, hold the suspension | Required at FEI levels (Intermediate II, Grand Prix); demonstrates ultimate collection and engagement of the hindquarters. | Dressage |
| Canter pirouette | reps | 4 | A 360° turn at the canter on the haunches — the hind legs maintain the canter rhythm nearly in place while the forehand describes a small circle around them. Six to eight strides for a full turn. | Sit, collect, turn on the haunches | One of the most difficult Grand Prix movements; the ultimate test of collection, balance, and obedience under canter. | Dressage |
| Piaffe | mins | 3 | A trot in place with the diagonal pairs lifting in measured cadence and clear suspension. The horse stays on the spot or steps barely forward, weight shifted onto the hindquarters. | Trot in place, weight behind | The signature Grand Prix movement; demonstrates maximum collection and the horse's ability to carry weight behind. | Dressage |
| Renvers | reps | 4 | Haunches-out on three or four tracks. The horse bends in the direction of travel, with the forehand on the inner track and the haunches displaced toward the wall. | Bend to the wall, haunches out | The mirror of travers; deepens suppleness and engagement, required from Third Level dressage upward. | Lateral Work |
| Extended trot | reps | 4 | Maximum reach and ground cover at the trot without quickening the tempo. The frame lengthens, the stride opens, but the rhythm stays the same as the working trot. | Open the frame, same tempo | Showcases the gaits; a scored movement at every dressage level from First upward and a hallmark of training. | Transitions |
| Travers | reps | 4 | Haunches-in on three or four tracks. The horse bends in the direction of travel with the haunches displaced off the track toward the inside. | Bend to the inside, haunches in | Suppling exercise that prepares the horse for half-pass and canter pirouette; appears from Second Level dressage. | Lateral Work |

## 3. Seed insert
Single Python script with `NORM` map + dedup `seen` set (same shape as gymnastics/fencing). Inserts 26 rows into `seed_moves` with: `name`, `description`, `cue`, `why`, `category`, `default_target_kind` (`reps` or `mins` per source), `default_target_value`.

## 4. No other code changes
Sport-key validator accepts arbitrary slugs; onboarding multi-select and hours step pre-populate automatically.
