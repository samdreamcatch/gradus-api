# Coach post-event action item

## What's happening

Nothing is broken with the demo data — the seeded event is there and complete: `Gradus Demo Invitational` ended Sep 1, Jamie Gilmore is linked, two result rows exist, and the parent recap has been submitted.

The reason Tami sees nothing is that the post-event prompt was only ever built for parents and athletes. It renders on the shared authenticated shell but is explicitly gated to `role === "parent" || role === "athlete"`. The only coach-side surface for a finished competition is the "Competition results" section buried inside an athlete's detail sheet on the roster — a coach has to already know to go look.

## What to build

A coach-facing post-event action item that appears on the roster (the coach home) whenever a rostered athlete has just competed.

The card shows, for each finished competition in the last 7 days involving a rostered athlete:

- Athlete name and competition name / dates
- Their placements in one line (e.g. "Short program 4th · Free skate 2nd")
- A note when the athlete or parent has left a recap
- Primary action: **Review results** — opens that athlete's detail sheet scrolled to Competition results, where the existing "Generate draft plan" and protocol views already live
- Secondary action: **Not now** — dismisses that competition for that coach

Multiple athletes at the same event stack as separate rows in one card, so a busy weekend doesn't flood the roster.

## Technical notes

- New server fn `listCoachPostEventItems` in `src/lib/competition-results.functions.ts`, auth-gated with `requireSupabaseAuth`: resolve the caller's coach id, join `coach_athletes` → `athlete_competition_skaters` → `competitions` where `ends_on` is within the last 7 days, pull placements from `athlete_competition_results` and a recap flag from `competition_recaps`.
- New component `src/components/coach/post-event-prompt.tsx` built from existing primitives only (`Card variant="section"`, `Button`, `Eyebrow`), mirroring the shape of `competition-recap-prompt.tsx` so it reads as the same family of action item.
- Dismissal: reuse `competition_attendance` (it already carries `dismissed_at` and is keyed by user) rather than adding a table, so no migration is needed unless the coach row shape doesn't fit — in that case add a small `competition_coach_dismissals` table with GRANTs and RLS scoped to the coach's own rows in the same migration.
- Render it at the top of the roster route rather than in `_authenticated.tsx`, so it sits in the coach's working surface and doesn't appear over messages or settings.
- Opening the athlete detail sheet from the card reuses the existing sheet state on the roster page; no new sheet.
