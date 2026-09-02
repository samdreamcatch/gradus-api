## Technical detail

### Staged schema (additive, applies when the draft is accepted)

- `athlete_competition_skaters` — the claim. Columns: athlete_id, competition_id,
  skater name as printed, club, optional IJS skater key, confirmed_by user, role
  (coach/parent/athlete), created_at. Unique on (competition_id, skater name, athlete_id).
  RLS: readable and writable by anyone who already has write access to that athlete —
  reuse the existing `guardian_can_write_athlete`, `parent_can_write`, and coach-roster
  helpers rather than inventing new predicates. GRANTs to authenticated + service_role;
  no anon.
- `athlete_competition_results` — one row per athlete per event per segment:
  competition_id, event name, segment, rink, start order, placement, segment score,
  total, and the parsed protocol as jsonb. Unique on
  (athlete_id, competition_id, event, segment) so refreshes upsert instead of duplicate.
  RLS mirrors the claim table; service_role writes.

Nothing is dropped or retyped; `competitions` and `competition_snapshots` keep their
current shape and behaviour.

### Write path

`board-refresh.server.ts` already parses full protocols per skater. After it stores the
snapshot, it looks up claims for that competition and upserts a result row for each
matched skater using the service-role client. Unclaimed skaters are skipped, so the
storage footprint tracks the roster, not the event.

### Claim UI

Reuses existing surfaces: a Sheet from the board skater row listing athletes the viewer
can write to, with likely name matches ordered first. Confirm writes the claim; a quiet
Unlink control removes it. Same component serves coach, parent, and athlete — the list
of selectable athletes is what differs, and that is already role-scoped server-side.

### Athlete score history

A new tab on the coach's athlete view reading `athlete_competition_results` through an
authenticated server function, rendering placement, segment scores, and the element
breakdown with the existing protocol detail component from the board.

### Out of scope here

Plan generation from scores, cross-athlete comparison, and backfilling history from
competitions added before a claim exists.
