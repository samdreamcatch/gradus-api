## Technical detail

### Staged schema (additive, applies when the draft is accepted)

- `athlete_competition_skaters` — the link: athlete_id, competition_id, skater name as
  printed, club, optional IJS skater key, linked_by user, created_at. Unique on
  (athlete_id, competition_id).
- `athlete_competition_results` — one row per athlete per event per segment:
  competition_id, event name, segment, rink, start order, placement, segment score,
  total, protocol jsonb. Unique on (athlete_id, competition_id, event, segment) so a
  re-fetch upserts instead of duplicating.

`competitions` and `competition_snapshots` are untouched.

### Access control

GRANTs to `authenticated` and `service_role` only — no `anon`, so a signed-out board
viewer can neither read nor write either table.

RLS reuses existing predicates rather than inventing new ones:

- INSERT / DELETE on `athlete_competition_skaters`: the caller's coach id must appear in
  `coach_athletes` for that athlete. The same predicate is repeated in `WITH CHECK`, so
  a hand-crafted request naming another coach's athlete is rejected at the database.
- SELECT on both tables: the rostered coach, plus the athlete's existing circle
  (`guardian_can_write_athlete`, `parent_can_write`, `is_self_managed_athlete`) so a
  parent can see and remove a link a coach made.
- Writes to `athlete_competition_results` are service-role only, from the fetch path.

The server function that lists linkable athletes derives them from `requireSupabaseAuth`
context and the coach's roster — never from a client-supplied athlete id. Name matching
runs after that list is fixed, so it can only rank, never widen.

### Match suggestions

A server function takes an athlete id (validated against the roster), pulls the finished
competitions from `competition_snapshots`, and returns skaters whose names are close to
the athlete's, with club and event for disambiguation. Only competitions whose results
are final are considered.

### Results capture

On confirm, the flow reads the current snapshot for that competition and upserts the
athlete's rows in `athlete_competition_results` using the service-role client inside the
handler. `board-refresh.server.ts` then keeps linked athletes current on later refreshes;
unlinked skaters are skipped, so storage tracks the roster, not the event.

### Draft plan generation

A `createServerFn` under `requireSupabaseAuth` re-checks the roster link, builds a prompt
from the stored protocol (negative-GOE and underrotated elements, lowest program
components, placement context), and calls the AI gateway through the existing plan
generation path. Output is written as a `plans` row with `status = draft` and
`source = 'competition'`, plus `plan_moves`, reusing the coach's existing move library
where names match. The coach edits and shares it like any other AI draft.

### Surfaces

- Athlete page: a "Competition results" section listing linked events with placement and
  scores, an unlink control, and the Generate draft plan action. Uses the existing Sheet,
  and the board's protocol detail component for element breakdowns.
- Board: unchanged. No new controls, no indication that a skater is linked.

### Out of scope

Parent- or athlete-initiated linking, cross-athlete comparison, and backfilling
competitions that predate the linked athlete's account.
