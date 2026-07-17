# Rework the "Start a conversation" picker for scale

## Problem
The current picker renders every athlete, parent, and coach in a single long stack of grouped cards. For a coach with 15+ athletes (plus each athlete's parents and any shared-athlete coaches), it becomes an unscrollable wall — and the interaction cost of finding one person grows linearly.

It also uses the retired plain `Dialog`, which violates our overlay doctrine (Sheet for views/pickers).

## Goal
Make finding a recipient fast at any roster size, using only components and patterns already in the design system.

## Design

Move the picker from `Dialog` → bottom `Sheet` (`paper-surface`, matches other pickers). Inside the sheet, three reused patterns handle scale:

1. **Sticky search field at the top** — filters across all groups by name (and by athlete name for parent/coach secondary labels, so "Jamie" surfaces Jamie, Lorelai Gilmore, and Alex Brinkley). Reuses the existing `Input` + search-icon pattern used elsewhere in the app.

2. **Segmented filter (All / Athletes / Parents / Coaches)** directly under the search — same segmented-toggle component and `press-soft` behavior used across settings/roster filters. "All" is default. Counts shown per segment (e.g. `Athletes · 17`).

3. **Grouped, virtualized-feeling list** — same divided card list as today, but:
   - When "All" is selected and a group has > 6 members, that group collapses to the first 6 with a `Show all N` affordance (reused disclosure pattern).
   - When a single segment is selected, the group header is hidden and the full list scrolls inside the sheet body (sheet content already scrolls).
   - Empty search state uses the existing hand-font empty message.

Row content is unchanged (primary label + secondary label + `MESSAGE` action) so muscle memory is preserved.

## Behavior details
- Search is case-insensitive, matches `primaryLabel` and `secondaryLabel`.
- Segment counts reflect pre-search totals; when searching, counts update to matches.
- Selecting a row still calls the same `ensureRoomForTarget` / `ensureDirectRoom` mutations and navigates to the room — no server changes.
- Textarea/search input auto-focuses on sheet open (mobile keyboard-friendly).
- Sheet on mobile slides from bottom; on desktop uses the standard side sheet pattern already in use.

## Technical notes
- Edit only `src/components/messages/new-conversation-button.tsx`.
- Swap `Dialog*` imports for `Sheet*` (`side="bottom"` on mobile via existing responsive sheet usage in the codebase; check `src/components/ui/sheet.tsx` for the shared component).
- Add local `useState` for `query` and `segment: "all" | "Athletes" | "Parents" | "Coaches"`.
- Derive filtered/grouped targets with `useMemo`.
- No server-fn, no schema, no new dependencies.
- Existing `listMyMessageTargets` already returns everything needed.

## Out of scope
- Recent conversations shortcut (could be a Phase 2 if useful).
- Server-side pagination — target lists are bounded by the coach's own roster, so client-side filtering is sufficient.
- Changing row visuals or the underlying message target model.
