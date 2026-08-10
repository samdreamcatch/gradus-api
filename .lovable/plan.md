# Gradus starter programs (figure skating first)

Give a brand-new athlete something real to do the moment they finish onboarding — before any coach exists. When they pick Figure Skating and a level, Gradus creates the competition program(s) for that level as plans attributed to "Gradus" instead of a coach.

## What the athlete sees

- Finish onboarding with sport = Figure Skating and a level selected.
- Their Plans list already contains the program(s) for their level, e.g. a Junior athlete gets **Junior — Short Program** and **Junior — Free Skate**.
- Each plan lists the program's elements as moves (Double Axel, Fly Sit Spin, Change Foot Combo Spin, Step Sequence, …), in the order and element-type grouping from the source chart.
- The plan is labeled **from Gradus** everywhere a coach name normally appears (list card, plan detail, session logging).
- They can start sessions, log mood/notes, and use it exactly like a coach-assigned plan.

## Level mapping

Exact match to the athlete's selected level; anything without a program falls back to Juvenile.

| Selected level | Program(s) created |
| --- | --- |
| Basic Skills, Pre-Preliminary, Preliminary, Pre-Juvenile | Juvenile — Free Skate |
| Juvenile | Juvenile — Free Skate |
| Intermediate | Intermediate SP + Intermediate FS |
| Novice | Novice SP + Novice FS |
| Junior | Junior SP + Junior FS |
| Senior | Senior SP + Senior FS |

Two known gaps in the source data, carried in as-is for now: Intermediate FS is one element short of 12, and Junior SP has no step sequence. Flagged so they can be corrected later without a code change.

## When it runs

At the moment the athlete's goal row is written with a sport and level — the three places that happens today:

- Parent-created athlete during parent signup
- Adult athlete self-signup
- Goals edited later in settings (only creates programs if the athlete has none yet for that sport)

Creation is idempotent: re-running never duplicates plans, and if the athlete already has a Gradus program for that sport it is left alone (we do not swap programs when a level changes — their logged sessions stay intact).

## When a coach joins

The Gradus program stays put and keeps working. Any coach linked to that athlete sees it in the athlete's plan list with an **Adopt** action: adopting sets the coach as owner, after which it behaves as a normal coach plan they can rename, reorder, and edit. Until adopted it stays read-only to the coach and attributed to Gradus.

## Other sports

The mechanism is sport-agnostic from day one — programs live in a single data catalog keyed by `sport` + `level`. Figure skating ships populated; other sports simply have no entries yet, so nothing is created for them. Adding tennis or gymnastics later means adding data, not code.

---

## Technical notes

**Data source.** Convert the uploaded workbook into a checked-in TS catalog, `src/data/starter-programs.ts`:

```ts
export interface StarterProgramMove { name: string; elementType: string; position: number }
export interface StarterProgram { key: string; title: string; moves: StarterProgramMove[] }
// STARTER_PROGRAMS: Record<SportKey, Record<levelKey, StarterProgram[]>>
// resolveStarterPrograms(sport, levelKey): StarterProgram[]  // handles the Juvenile fallback
```

Element type becomes the move's `description`; `target_kind = "reps"`, `target_value = 1` as the default target (elements are performed, not timed).

**Persistence.** Reuse the existing `plans` / `plan_moves` tables. `plans.coach_id` is already nullable — a Gradus plan is `coach_id IS NULL`, `kind = 'plan'`, `athlete_id = <athlete>`, `status = 'active'`. `plan_moves.move_id` stays null (no library `moves` row needed), with name/description/cue/why written inline as the schema already allows.

Migration needed for:
- A marker column on `plans` (e.g. `source text not null default 'coach'`, values `coach` | `gradus`) so adoption and idempotency checks are unambiguous, plus a partial unique index on `(athlete_id, title)` where `source = 'gradus'`.
- RLS: athletes can already read plans by `athlete_id`; add coach read + adopt-update policies for `source = 'gradus'` plans belonging to a rostered athlete.

**Server work.**
- New `src/lib/starter-programs.functions.ts` with an internal `ensureStarterPrograms(athleteId, sport, levelKey)` helper (`.server.ts` side) called from `parent-signup.functions.ts:518`, `adult-athlete-signup.functions.ts:322`, and `parent-settings.functions.ts:347` after the goal upsert. Runs through `supabaseAdmin`, wrapped so a failure never blocks signup.
- `adoptStarterPlan` server fn (coach-auth) setting `coach_id` and `source = 'coach'`.

**Display.** `listAthletePlans` / `getAthletePlan` in `src/lib/athlete-plans.functions.ts` currently fall back to `coachName: "Coach"` when `coach_id` is null. Change that fallback to `"Gradus"` and add `isGradus: boolean` to the DTOs so the card/detail can style the attribution. Same fallback change in the parent-facing plan list.

**Verification.** Seed a dev figure-skating athlete at Pre-Juvenile and at Junior; confirm 1 and 2 plans respectively, correct element counts, "from Gradus" attribution, session logging works, and re-running onboarding creates no duplicates.
