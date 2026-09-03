# Coach post-event action item

## Answer first: where the linking workflow lives

The "match my athlete to a published skater" flow does exist, but it is entirely manual and coach-initiated. Nothing triggers it.

- It lives on the roster, inside an athlete's detail sheet, in the "Competition results" section (`src/components/coach/competition-results-section.tsx`).
- The coach taps **Link results**, picks a finished competition from the list, then confirms which published skater is their athlete. That writes the link and pulls in the results.
- There is no prompt, badge, notification, or card anywhere that tells a coach a rostered athlete just competed. A coach has to remember to open each athlete and check.

That is why Tami sees nothing. The demo data is fine: `Gradus Demo Invitational` ended Sep 1, Jamie Gilmore is already linked, two result rows exist, and the parent recap is in. The only post-event prompt that was ever built is gated to parents and athletes.

## What to build

A coach-facing post-event action item on the roster (coach home) covering both halves of the workflow — the missing trigger and the review step.

**1. "Just competed" trigger (the missing piece)**
For any rostered athlete whose competition finished in the last 7 days and who is *not yet linked*, show: "Jamie may have competed at Gradus Demo Invitational" with a **Link results** action that opens the existing link sheet directly to that competition and its skater matches. Detection uses name matching against the published skater list, the same ranking `listSkaterMatches` already does.

**2. "Results are in" review item**
For a rostered athlete who *is* linked and has results, show placements in one line (e.g. "Short program 4th · Free skate 2nd"), a note when a parent or athlete has left a recap, and a **Review results** action that opens the athlete detail sheet at Competition results, where "Generate draft plan" and the protocols already live.

Both kinds get a **Not now** dismissal. Multiple athletes at one event stack as rows inside a single card, so a busy weekend doesn't flood the roster.

## Technical notes

- New server fn `listCoachPostEventItems` in `src/lib/competition-results.functions.ts`, auth-gated with `requireSupabaseAuth`: resolve the caller's coach id, join `coach_athletes` → `competitions` with `ends_on` inside the last 7 days, then split athletes into linked (join `athlete_competition_skaters`, pull placements from `athlete_competition_results`, recap flag from `competition_recaps`) and unlinked-but-likely (reuse the existing skater name-match ranking, only surface above a confidence threshold).
- New component `src/components/coach/post-event-prompt.tsx` from existing primitives only (`Card variant="section"`, `Button`, `Eyebrow`), mirroring `competition-recap-prompt.tsx` so it reads as the same family of action item.
- Refactor `LinkCompetitionSheet` in `competition-results-section.tsx` to accept an optional preselected `competitionId` and export it, so the prompt can open it without duplicating the flow.
- Dismissal: a small `competition_coach_dismissals` table (coach_id, competition_id, athlete_id, dismissed_at) with GRANTs and RLS scoped to the coach's own rows in the same migration.
- Render at the top of the roster route, not `_authenticated.tsx`, so it sits in the coach's working surface and never appears over messages or settings.
