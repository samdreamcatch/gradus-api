# Club Admin: Airtable-style once-over + Schedule calendar view

## Goal
Make every club admin page read like a well-built database: one consistent toolbar, switchable views, clear column types, and a side panel to open any row. Start with Schedule, which gets a Spreadsheet / Calendar toggle.

## 1. Schedule: Spreadsheet / Calendar toggle
- A view switcher in the page toolbar: **Grid** (today's per-lesson table) and **Calendar**.
- Calendar has **Week** (default; columns are days, lessons placed by time) and **Month** (lessons listed in day cells, "+3 more" when a day is full).
- Each lesson block shows the student, coach and time, color-coded by coach and marked when contacts are missing or the invite hasn't been sent.
- Clicking a lesson in either view opens the same record panel (student, guardian, contacts, lesson time, invite status).
- The chosen view and week are kept in the address, so a link or refresh opens the same view.
- Filters (coach, missing contacts, invite status) apply to both views.

## 2. A shared "database page" layout for every admin page
Same structure on every page:

```text
Page title + record count
[ View: Grid | Calendar* ]  [Search]  [Filter]  [Sort]  [Group]  [Fields]   [+ New]
-------------------------------------------------------------------------------
| ☐ | Name ▾      | Type chip | Status ● | Date      | Owner   |  ...          |
| ☐ | ...  (click a row -> record panel slides in from the right)             |
-------------------------------------------------------------------------------
 142 records · 3 selected  [Bulk actions]
```
*Calendar only appears where records have dates.

- **Toolbar:** search, filter, sort, group-by and show/hide fields, in one place on every page, with pill counts for active filters ("Filtered by 2").
- **Column types that look the part:** colored chips for categories (sport, level, audience), the existing status dot for states, avatars + names for people, tidy dates, numbers right-aligned, link icons for files.
- **Sticky header and first column**, compact row height, column headers with a type icon.
- **Record panel (side sheet)** instead of inline expansion or separate edit screens: view all fields, edit, see history/sign-offs.
- **Grouping** with collapsible group headers and counts (e.g. Resources by sport, People by role, Schedule by coach).
- **Selection + bulk action bar** at the bottom where bulk actions already exist (archive, distribute, remind).
- **Footer summary:** record count, and totals where useful (seats used, sign-off %).
- Empty, loading and "no matches for this filter" states that say what to do next.

## 3. Page-by-page
| Page | Views | Group by default | Record panel shows |
|---|---|---|---|
| Schedule | Grid, Calendar | Coach | Lesson, student, guardian, invite |
| People / Roster | Grid | Role | Seat, invites, policy sign-offs |
| Resources | Grid, Gallery (file cards) | Sport | File, audience, acknowledgements |
| Policies | Grid | Status | Versions, who signed / pending |
| Moves, Levels, Templates | Grid | Sport | Details, deployments |
| Notifications | Grid | Source | Evidence notes, read receipts |
| Coaching (analytics) | Unchanged charts; tables adopt the grid style | — | — |

Home, Settings and Builder keep their current layouts but pick up the shared header and spacing.

## 4. Rollout order
1. Shared toolbar, grid styling and record panel, applied to Schedule + Calendar view.
2. People/Roster and Resources (incl. Gallery).
3. Policies, Notifications, Moves, Levels, Templates.
Each step is reviewable on its own.

## Not changing
Data, permissions, invite sending, and the Gradus design system (paper surfaces, pen accent, Garamond) — Airtable is the model for structure and clarity, not its colors.

## Technical details
- Extend `ClubTable` into a `ClubGrid` (toolbar, sticky header, typed cell renderers, group/selection) built on existing `Table`, `Chip`, `StatusDot`, `DropdownMenu`, `Popover`, `Sheet`, `ToggleGroup`; no new libraries.
- Calendar view: a week/month grid built from existing tokens, fed by the current `club-lesson-calendar` per-lesson data; occurrence expansion stays in the pure tested helper, with new tests for week/month placement.
- View/filter/sort/group state in route search params (validated), so views are linkable.
- Record panel uses `Sheet` (side, `bg-popover`) per overlay doctrine; press utilities only, no hover styling on controls.
