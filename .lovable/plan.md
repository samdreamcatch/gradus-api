# Add Track & Field sport

## 1. `src/lib/coach-sports.ts`
- Add `"track_field"` to `SportKey` union.
- Append `track_field` entry to `SPORTS`. `label: "Track & Field"`, `standard: ""`. 5 levels: Youth, High School, Collegiate, Elite, Professional. `suggestedHours`: 3, 6, 12, 18, 22.

## 2. Move library (41 rows → `public.seed_moves`, `sport='track_field'`)

**Category normalization** (6 buckets — merge Distance Running → Distance, merge Steeplechase → Hurdles):
- Sprints
- Distance
- Jumps
- Hurdles (includes steeplechase)
- Throws
- Race Walking

**20 complete rows** inserted verbatim with the merged-category mapping.

**21 gap rows filled** (standard references, in the same voice):

| Move | Kind | Target | Category |
|---|---|---|---|
| 1500m / mile race strategy | reps | 4 | Distance |
| B-skip | reps | 10 | Sprints |
| Weight throw | reps | 12 | Throws |
| Build-ups / strides | reps | 6 | Distance |
| A-skip | reps | 10 | Sprints |
| Butt kicks | reps | 10 | Sprints |
| Hammer throw | reps | 12 | Throws |
| Steeplechase water jump | reps | 6 | Hurdles |
| Steeplechase barrier clearance | reps | 8 | Hurdles |
| 5K / 10K race strategy | reps | 4 | Distance |
| Stride rate drill | reps | 6 | Sprints |
| Ankle paw-back drill | reps | 8 | Sprints |
| Race walking technique | mins | 10 | Race Walking |
| Fartlek run | mins | 30 | Distance |
| Standing long jump | reps | 6 | Jumps |
| High knees | reps | 10 | Sprints |
| Bounding | reps | 8 | Jumps |
| Sprint arm drive drill | reps | 8 | Sprints |
| Standing triple jump | reps | 6 | Jumps |
| Hill sprint | reps | 8 | Sprints |

(Note: Bounding moved to Jumps, Hill sprint moved to Sprints — these are more accurate buckets than the source's "Distance" label for plyometric/power work. **Confirm or I'll keep as written.**)

Each gap row gets a 2–3 sentence description, a short cue, and a one-line why grounded in standard track coaching (e.g. A-skip: "Drive knee up to parallel, foot dorsiflexed, strike under hip. Single bounce between reps." cue "Knee up, toe up" why "Reinforces the sprint cycle in slow motion — the foundation drill of every sprint warm-up.").

## 3. Seed insert
Single SQL INSERT via supabase--insert with all 41 rows. `default_target_kind` set per move (mins for sustained efforts, reps for everything else).

## 4. No other code changes
Sport-key validator accepts arbitrary slugs; onboarding multi-select and hours step pre-populate automatically.
