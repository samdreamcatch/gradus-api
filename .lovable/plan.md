## Goal

Give a coach enough signal about their athlete's *other* coaches' plans to coordinate — surfacing full plan content (moves + notes) since both coaches share the same athlete. Must scale cleanly to up to 4 other coaches (5 total).

**Intent:** coordination.
**Surfaces:** Athlete Detail Sheet (primary) + Roster card chip (secondary).

## Why the treatment changes at N=4

The earlier "handwritten margin line per other coach" reads beautifully at N=1–2, but at N=4 it becomes four Caveat lines stacked in an already-long sheet, and each line hides a plan set behind a tap — too much invisible content. At scale, coaches need a scannable **list of coaches**, not a paragraph of margin notes.

## What a coach sees

### 1. Athlete Detail Sheet — new "Also coached by" section

Inserted immediately after the existing Plans section. Renders nothing when there are no other coaches. Uses the same `SectionHeading` treatment as sibling sections ("ALSO COACHED BY").

**One compact row per other coach** (up to 4):

- Left: coach avatar / initials chip (same treatment used elsewhere for coach identity)
- Coach name (`text-text-primary font-bold`) with a single `pen-highlight` under the last name
- Sport chips for the sports they coach *this athlete* in (from `coach_athlete_sports`)
- Meta line, `font-hand text-text-secondary text-sm`: *"2 active plans · 1 benched"* (or *"No active plans"* if all benched, or hide the row if they have zero `active`/`benched` plans)
- Right: chevron; row uses `press`

Tapping a row opens a nested `Sheet` (`side="bottom"`, `paper-surface`) with that coach's plans.

**Sheet content** (one per coach):

- Header: coach name, sport chips
- One expanded card per plan (Active first, then Benched):
  - Title + status pill (Active pen-tennis / Benched muted)
  - Meta row: "Updated 3d ago" · "12 sessions in last 30d"
  - Plan notes if any (read-only, `text-text-secondary`)
  - **Move list** — position, name, description, cue, why, target — read-only, styled like the athlete-facing shared-plan viewer
- Read-only throughout. No edit, no reorder, no navigation to that coach's `/coach/plans/$planId`.

### 2. Roster card — "+N coaches" chip

On each `RosterCard` (Athletes and Schedule tabs), when the athlete has coaches beyond the viewer, show a small `Badge` in the existing meta row:

- N = 1: `+ D. Wallace`
- N ≥ 2: `+2 coaches` (or `+4 coaches` — cap at the raw count)

Never expand to a list of initials — at 4 it gets noisy and unreadable at card width. The number is the signal; the sheet is where identities live.

## Privacy & scope

- Both coaches are linked to this athlete via `coach_athletes` — surfacing moves + notes is in-scope for coordination.
- Still **not exposed:** per-session logs / practice notes from the athlete (that's the athlete↔other-coach relationship), the other coach's messaging thread, the other coach's private draft/template plans (only `kind = 'plan'` and `status IN ('active','benched')` for *this* athlete).
- Read view only.

## Design system

- Sheet: existing shadcn `Sheet side="bottom"`, `paper-surface`. Nested inside the athlete sheet.
- "Also coached by" list: reuse the card / row treatment used for existing roster or messaging peer lists — no new component skeleton.
- Status pills: reuse `PlanCard` `edgeTone`.
- Move rows: reuse the read-only move row styling from the shared-plan viewer.
- Roster badge: existing `Badge`, `variant="secondary"`.
- Overlay doctrine: Sheet for the plan view, no Popover (content too rich); mobile top-alignment N/A for a bottom sheet.
- No new colors, no `hover:*`, `press` on interactive rows only.

## Technical outline

**Data**

- Extend `getCoachAthleteDetail` (`src/lib/coach-athlete-detail.functions.ts`) to also return:
  ```
  otherCoaches: Array<{
    coachId, firstName, lastName, lastInitial,
    sports: string[],                    // from coach_athlete_sports
    activeCount, benchedCount,
    plans: Array<{
      planId, title, status: 'active'|'benched',
      updatedAt, sessionsLast30d,
      notes: string | null,
      moves: Array<{
        position, name, description, cue, why,
        targetKind, targetValue,
      }>
    }>
  }>
  ```
  Query: `plans` where `athlete_id = X AND coach_id != mine AND kind = 'plan' AND status IN ('active','benched')`, join `coach_profiles` and `coach_athlete_sports`, and pull `plan_moves` in one grouped fetch keyed by plan id. Reuse the already-fetched `sessions30d` to compute `sessionsLast30d` per plan — no extra round trip. Sort by (most recent active plan) desc so the busiest coaches surface first.
- Extend `getCoachRoster` to return `otherCoachCount` per athlete (plus the single `otherCoachLastName` used when N=1).

**UI**

- New `src/components/coach/also-coached-by-list.tsx` — the section header + rows in the athlete sheet.
- New `src/components/coach/other-coach-plans-sheet.tsx` — the nested Sheet + read-only plan cards.
- `src/components/coach/athlete-detail-sheet.tsx`: after `PlansList`, render `AlsoCoachedByList` (renders nothing when empty).
- `src/components/coach/roster-card.tsx`: add the `Badge` in the existing meta row when `athlete.otherCoachCount > 0`.

**Access / privacy**

- Caller already gated by `assertCoachOwnsAthlete`. Other-coach reads use `supabaseAdmin` like the sibling function; DTO ships only the shape above.

## Not building

- Coach chip filter above Plans (option B). Toggling identities implies parity; the athlete-notebook model is stronger with your own plans as the page.
- Inline collapsible group inside your own Plans. Merges "yours vs theirs" into one list; at N=4 that's confusing.
- Plan Detail footer note. Deferred.
- Club-oversight cross-athlete table. Different feature.
