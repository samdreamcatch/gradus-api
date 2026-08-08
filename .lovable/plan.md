# Athlete resources: full library, with Safe Sport kept as a tab

Give youth and adult athletes the same Resources experience parents have — a searchable library of coach uploads and Gradus library items — while keeping the existing Safe Sport content intact as one of the tabs.

## What changes for athletes

The Resources page gets four views in the toggle:

- **Library** (new, default) — coach uploads first ("From your coaches"), then the Gradus library, with a search box and a sport picker, exactly like the parent page.
- **Safe Sport** — unchanged content: hotlines, "does this count?", trusted adult, SafeSport link.
- **Ask Gradus** — unchanged.
- **Saved** — unchanged.

Youth and adult athletes share the same `/athlete/resources` route, so both get this automatically. Nothing about Safe Sport is removed or reworded.

If an athlete has no sport yet, the page keeps its current empty state; Safe Sport stays reachable regardless of sport (it isn't sport-specific).

## Technical notes

- `src/lib/athlete-resources.functions.ts`: extend `getAthleteResources` to also return `resources`, mirroring `getParentResources` — library rows (`coach_id IS NULL`, published, sport in the athlete's sports) plus coach uploads (`coach_id NOT NULL`, RLS-scoped) with coach name and `resource_sports` tags. Athlete sports come from `athlete_goals` plus `coach_athlete_sports` for the athlete's own id. Reuse the existing `ResourceDTO` shape from `parent-resources.functions.ts` so the shared components need no changes.
- No database or RLS work needed: the existing `resources` policies already grant athletes read access to library rows and to their coaches' uploads via `athlete_has_coach_upload`.
- Extract the Safe Sport UI (`SafeSportPanel`, `HotlineCard`, `CountsDisclosure`, `TrustedAdultDisclosure`, hotline data) from `src/routes/_authenticated/athlete.resources.index.tsx` into `src/components/resources/safe-sport-panel.tsx`, moved verbatim.
- Rewrite the athlete route to use the shared `ResourceList`, `ResourceSheet`, `AskGradusCard`, `SavedAnswersList`, `FilterBar`, and `SegmentedToggle` — the same structure as `parent.resources.index.tsx`, with the extra Safe Sport tab.
- Opening a PDF/image resource uses the existing `getResourceSignedUrl` server function (already used by the shared `ResourceSheet`; RLS gates visibility).
