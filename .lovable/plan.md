# /coach/plans — Core Authoring Loop

## Scope

Phase 1 (this plan): full CRUD for moves, plans, and templates. Mobile-first, on-brand.
Phase 2 (separate plan): AI text editor (and later voice) for generating/editing plans + templates.

## Data model

New tables (all RLS-scoped to `auth.uid()` via `coach_profiles`):

**moves** — coach-owned library entry
- `coach_id`, `sport`, `category`, `name`
- `description` (the long coach-facing detail), `cue` (short cue), `why` (rationale)
- `default_target_kind` (`reps` | `minutes`), `default_target_value` (numeric)
- `archived_at` (soft delete)

**plans** — a plan or a template
- `coach_id`, `title`, `notes`
- `kind`: `'plan'` | `'template'`
- `athlete_id` (nullable; required when kind=plan)
- `status`: `'active'` | `'benched'` (only meaningful for kind=plan)
- `created_at`, `updated_at`

**plan_moves** — ordered moves inside a plan
- `plan_id`, `position` (int), `move_id` (nullable — keeps link if move not deleted)
- Snapshot fields (editable per-plan, do NOT mutate the library):
  `name`, `description`, `cue`, `why`, `target_kind`, `target_value`

Validation:
- Saving with kind=plan requires `athlete_id`; with kind=template requires `athlete_id IS NULL`.
- Activating a plan: server fn sets `status='benched'` on any existing active plan for that `(coach_id, athlete_id)` pair, then sets new one active. One active per coach per athlete (athlete can still have actives from other coaches).

Seeding:
- Migration loads the 158-row CSV into a `seed_moves` table (sport, category, name, description, cue, why, target_kind, target_value).
- A `seed_coach_library(coach_id)` SQL function inserts rows from `seed_moves` into `moves` filtered by the sports in `coach_levels` for that coach.
- Run automatically once when a coach first visits /coach/plans (idempotent: skip if they already have any moves).

Notes column collapse:
- CSV columns `Cue Note` + `Cue Note (Athlete)` → single `cue`.
- `Why Note` + `Why Note (Athlete)` → single `why`.
- `Coach Note` → `description`.
- Athlete UI will render with athlete-facing pronouns later; storage is single-source.

## Page structure (`/coach/plans`)

Top-level tab toggle (segmented control, on-brand):

```text
[ Plans ]  [ Library ]
```

### Plans tab
- Primary filter chips: `Active` · `Benched` · `Templates`
- Secondary filter: athlete dropdown (only visible when Active/Benched selected; shows coach's rostered athletes + "All")
- List of plan cards: title, athlete name (or "Template"), move count, summed total (e.g. "8 moves · ~22 min"), status pill
- FAB / pinned button: `+ New plan` → bottom sheet picker: *From scratch* / *From template* / *Duplicate existing*
- Tap a card → plan detail/editor route

### Library tab
- Sport filter chips (only shown if coach teaches >1 sport; pulled from `coach_levels`)
- Search by name
- Grouped by category (sticky category headers, sorted alphabetically)
- Each row: name, cue (1-line), default target ("10 reps" / "5 min"), small edit affordance
- FAB: `+ New move`

### Plan editor (`/coach/plans/$planId`)
- Header: editable title, athlete picker (or "Template" toggle), status toggle (Active/Benched) when assigned, total summary
- Notes textarea
- Ordered move list (drag-reorder), each item shows name + editable target + collapsible cue/why/description (snapshot edits apply only to this plan)
- "Add moves" bottom sheet → opens library picker (search + category groups, multi-select), inserts snapshots
- Save / Delete actions

### Move editor (library)
- Form: name, sport (locked to coach's sports), category (free-text with existing suggestions), description, cue, why, default target kind + value
- Archive button (soft delete; existing plan snapshots are unaffected)

## Routes

- `src/routes/_authenticated/coach.plans.tsx` — tab container (already exists, gets rewritten)
- `src/routes/_authenticated/coach.plans.$planId.tsx` — plan/template editor
- `src/routes/_authenticated/coach.plans.moves.$moveId.tsx` — move editor

## Server functions (`src/lib/plans.functions.ts`, `src/lib/moves.functions.ts`)

All use `requireSupabaseAuth`; resolve `coach_id` from `coach_profiles` by `user_id`.

- `ensureCoachLibrary()` — idempotent seed on first load
- `listMoves({ sport? })`, `upsertMove(input)`, `archiveMove(id)`
- `listPlans({ filter, athleteId? })` — returns plans with move counts + summed total
- `getPlan(id)` — plan + ordered plan_moves
- `savePlan(input)` — handles plan vs template validation, snapshot inserts
- `setPlanStatus({ planId, status })` — handles auto-bench of previous active
- `duplicatePlan(id, { asTemplate?, athleteId? })`

## Design system

- Tabs: pen-highlight on active tab label, divider underline
- Filter chips: `bg-elevated` default, `bg-accent text-accent-foreground` selected
- Plan/move cards: `bg-card` with `shadow-card`, hover lifts to `border-accent/50`
- Status pill: Tennis pen wash for active, divider grey for benched
- Empty states: Caveat handwritten copy + small CTA
- Respect existing `CoachBottomNav` (pb-32)

## Out of scope (Phase 2)

- AI text editor (Lovable AI Gemini Flash) for generating/editing plan content via prompt
- Voice recording → transcription
- Athlete-side plan viewer
- Sharing templates between coaches

## Open assumptions (flag if wrong)

- Categories are coach-editable free text (CSV values pre-seed the dropdown but coach can type new ones).
- Move snapshots in `plan_moves` are fully independent after creation — editing the library move later doesn't propagate.
- "Total minutes" sums minutes-kind moves only; reps moves don't contribute to the time estimate (display "8 moves · 5 min + 4 rep drills" style copy).
