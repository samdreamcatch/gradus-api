## Technical details

### Staged migration (applies when you accept the draft)

Two additive tables, in the same draft migrations folder as the live-board and competition-results tables.

`competition_attendance`
- `user_id`, `competition_id` (FK competitions), optional `athlete_id` (FK athletes), `skater_name`, `first_seen_at`, `dismissed_at`, `recap_done_at`
- unique `(user_id, competition_id)`
- GRANT SELECT/INSERT/UPDATE/DELETE to `authenticated`, ALL to `service_role`, no `anon`. RLS: rows scoped to `auth.uid() = user_id`.

`competition_recaps`
- `id`, `competition_id`, `athlete_id`, `author_user_id`, `author_role` (`parent` | `athlete`), `body text NOT NULL`, `created_at`
- unique `(competition_id, athlete_id, author_user_id)` so each person writes one recap per athlete per competition
- GRANT to `authenticated` + `service_role`, no `anon`. RLS SELECT for the athlete's circle using the existing helpers (`guardian_can_write_athlete`, `parent_can_write`, `is_self_managed_athlete`, plus a rostered-coach check against `coach_athletes`); INSERT/UPDATE restricted to the author, who must be in the athlete's circle (repeated in `WITH CHECK`). No coach writes.

### Server functions

New `src/lib/competition-recap.functions.ts`, all `requireSupabaseAuth`:
- `recordCompetitionAttendance({ slug })` — called once per board view by a signed-in visitor; upserts the attendance row. Resolves `athlete_id` from the single athlete the caller has in the competition's sport, refined by a name match if they later follow a skater, and left null only when the caller has two or more athletes in that sport.
- `getPendingCompetitionRecap()` — returns at most one attendance row whose competition has ended, is under 7 days old, and has no recap or dismissal; includes the candidate athlete list only when the sport-scoped resolution was ambiguous.
- `submitCompetitionRecap({ competitionId, athleteId, body })` — validates a non-empty body (max ~2000 chars), re-checks the caller's relationship to the athlete server-side, inserts the recap, stamps `recap_done_at`, then posts a message into the athlete's existing coach room(s) summarizing the recap and linking to the athlete's competition section. The message is sent by the author with their real role, using the existing `messages` insert path — no new messaging surface.
- `dismissCompetitionRecap({ competitionId })` — sets `dismissed_at`.

Competition end is read from `competitions.ends_on` (already stored) plus the snapshot's final status.

### Client

- `src/routes/board.$slug.tsx` — on mount, where the board is already written to local history, also fire `recordCompetitionAttendance` when a session exists. Signed-out visits stay device-local; if that visitor signs in later on the same device (the board already stashes a return path) we record the visit once at that point.
- New `src/components/board/competition-recap-prompt.tsx` — the card, rendered from `src/routes/_authenticated.tsx` alongside `FollowingBanner`, only for parent/athlete roles via `useViewerRole`.
- New `src/components/board/competition-recap-sheet.tsx` — bottom `Sheet` with the `paper-surface` utility: one label, one textarea using the existing `focus-input` styling, helper text below the label, and `press` on the submit button. No rating scale, no new design primitives.
- `src/components/coach/competition-results-section.tsx` — render saved recaps below the linked results, attributed to the writer.
- Parent/athlete surface: the same recap shows read-only on the athlete's own page.

### Notes

- The recap is a single required free-text body; submit stays disabled until something is typed.
- Sanitize the free text the same way other AI-adjacent inputs are, since it may later feed draft-plan generation.
