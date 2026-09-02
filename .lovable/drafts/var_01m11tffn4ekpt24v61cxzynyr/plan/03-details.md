## Technical detail

### Staged schema (additive, applies when the draft is accepted)

- `athlete_competition_skaters` — the claim. Columns: athlete_id, competition_id,
  skater name as printed, club, optional IJS skater key, confirmed_by user, role
  (coach/parent/athlete), created_at. Unique on (competition_id, skater name, athlete_id).
- `athlete_competition_results` — one row per athlete per event per segment:
  competition_id, event name, segment, rink, start order, placement, segment score,
  total, and the parsed protocol as jsonb. Unique on
  (athlete_id, competition_id, event, segment) so refreshes upsert instead of duplicate.

Nothing is dropped or retyped; `competitions` and `competition_snapshots` keep their
current shape and behaviour.

### Access control on the claim

Both tables get GRANTs to `authenticated` and `service_role` only — **no anon**, so a
signed-out board viewer cannot read or write either one.

RLS reuses the predicates that already govern athlete access rather than inventing
new ones:

- SELECT / INSERT / DELETE on `athlete_competition_skaters` require
  `guardian_can_write_athlete(athlete_id)` OR `parent_can_write(athlete_id)` OR
  `is_self_managed_athlete(athlete_id)` OR the caller's coach id appearing in
  `coach_athletes` for that athlete.
- The INSERT policy repeats the same predicate in `WITH CHECK`, so a crafted request
  naming someone else's athlete is rejected at the database, not just in the UI.
- SELECT on `athlete_competition_results` uses the same predicate, so score history
  is visible only to that athlete's existing circle.
- Writes to `athlete_competition_results` are service-role only, from the refresh job.

The server function that lists claimable athletes derives them from
`requireSupabaseAuth` context — never from a client-supplied athlete id — and returns
only athletes the caller can already write to. Suggested name matches are computed
after that list is fixed, so matching never widens the set.

### Minor-specific handling

For an athlete under 18, the claim is restricted to a guardian or a rostered coach —
a self-managed-athlete claim path applies only to adult accounts, consistent with the
existing guardian-email requirement for minors. Removing a claim is available to
anyone in that same set, so a guardian can always sever the link.

### Write path

`board-refresh.server.ts` already parses full protocols per skater. After it stores the
snapshot, it looks up claims for that competition and upserts a result row for each
matched skater using the service-role client. Unclaimed skaters are skipped, so the
storage footprint tracks the roster, not the event.

### Claim UI

Reuses existing surfaces: a Sheet listing the caller's own athletes with likely skater
matches from the current competition ordered first. Confirm writes the claim; a quiet
Unlink control removes it. Viewers with no write access to any athlete in the event
never see the entry point.

### Athlete score history

A new tab on the coach's athlete view reading `athlete_competition_results` through an
authenticated server function, rendering placement, segment scores, and the element
breakdown with the existing protocol detail component from the board.

### Out of scope here

Plan generation from scores, cross-athlete comparison, and backfilling history from
competitions added before a claim exists.
