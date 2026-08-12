# Sample athlete for new figure skating coaches

Give a figure skating coach with an empty roster a fully-populated demo athlete — Lisa Simpson (Juvenile) and her parent Marge Simpson — so the value of the app is visible before any real athlete joins. Everything is synthetic: no database rows are created, nothing to clean up, and no risk of demo data leaking into reports, invoices, or AI history.

## When it shows

- Coach's roster has zero athletes, AND
- Coach coaches figure skating, AND
- Coach hasn't dismissed it.

The moment a real athlete joins, the sample disappears on its own.

## What the coach sees

**Schedule tab (default view)**
- A lesson with Lisa starting within the next hour, on today's date, rendered by the existing week schedule.
- The existing "Up next briefing" card above it, expandable, showing a written briefing about Lisa's recent work — pre-written, not AI-generated, so it's instant and never fails.

**Athletes tab**
- One roster card: Lisa Simpson · Figure Skating · parent Marge Simpson, matching every other roster card.

**Athlete detail (tapping the card)**
- Goals: current level Juvenile, a season goal, and a long-term goal.
- The Juvenile figure skating starter plan (the same program new skaters are pre-populated with), shown as an active plan.
- 9 logged practice sessions across the last ~4 weeks, with flow-state distribution and short athlete feedback notes on each, plus practice/lesson minutes — all rendered by the existing detail sheet sections.
- A written coach summary in place of the AI summary block.

Everything is marked so it's unmistakably a demo: a "Sample" chip on the roster card and a one-line banner above the roster explaining it's a preview athlete, with a **Dismiss** action.

## Dismissing and restoring

- Dismiss hides the sample permanently for that coach (stored locally on the device, like the theme preference).
- Settings gains a "Sample athlete" row under the existing roster section that restores it, disabled/annotated once the coach has real athletes.

## Guardrails

Sample data is display-only. Actions that would write to the backend against the sample athlete (message, invoice, edit lesson, adopt plan, log wrap-up, remove from roster) are not offered for it — the row shows the Dismiss action instead. No server function is ever called with the sample ID.

## Technical notes

- New fixture module `src/data/sample-athlete.ts`: exports a sentinel ID (e.g. `sample-lisa-simpson`), a `RosterAthlete` shaped exactly like `coach-roster.functions.ts` returns, an `AthletePracticeSummary`, a `CoachAthleteDetail`-shaped object, and the briefing narrative text. Lesson slot day/time derived from `new Date()` at render so the lesson always lands in the next hour; session dates computed as offsets from today. Plan moves come from the existing Juvenile figure skating starter program in `src/data/starter-programs.ts` rather than being re-typed.
- `src/routes/_authenticated/coach.roster.tsx`: after `useSuspenseQuery`, if `athletes.length === 0 && coachSports.includes("figure_skating") && !dismissed`, substitute the sample athlete into `athletes` and add its summary to `summariesByAthlete`. Rest of the page is untouched.
- `src/components/coach/athlete-detail-sheet.tsx` and `pre-lesson-briefing.tsx`: short-circuit when the athlete ID is the sentinel — return fixture data instead of running the query (query `enabled: false`), so no server call fires.
- Dismiss state in `localStorage` under a `gradus.sampleAthleteDismissed` key with a small hook, following the pattern in `src/data/theme.ts`.
- Settings restore row uses the existing `SettingsDisclosure` / `Switch` primitives in `src/components/settings/primitives.tsx`.
- No migration, no new server functions, no design-system additions — existing `RosterCard`, `Chip`, `WeekScheduleView`, `PlanCard`, `FlowStateBars`, sheet and button components only.
