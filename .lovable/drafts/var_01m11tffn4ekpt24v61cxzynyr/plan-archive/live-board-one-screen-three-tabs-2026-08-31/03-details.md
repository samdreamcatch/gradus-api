## Technical details

Presentation only — no data, scraper, or server-function changes.

`src/routes/board.$slug.tsx`
- Replace the two `Chip` tabs with `SegmentedToggle` from
  `@/components/plans/segmented-toggle`, options `mine | rinks | schedule`.
  Keep the tab state variable; widen its union.
- Keep the existing tabpanel/live-region accessibility work: wrap the toggle in the
  `role="tablist"` container and keep `role="tabpanel"` on each panel, with the
  polite announcement region unchanged.
- Initial tab: `mine` when there is at least one match, else `rinks`. `goToRink`
  switches to `rinks` instead of `now`.
- Move `MySkaters` + `FollowSearch` into the Mine panel, rink chips + `RinkPanel`
  + the "next event" line into the Rinks panel, `ScheduleBoard` into Schedule.
- Header condenses to a single block; the footer disclaimer and updated-at line
  render only inside the Rinks panel.
- The signed-out sign-in prompt renders only in the Mine panel.

`src/components/board/follow-search.tsx`
- Collapse behind a single full-width row ("Follow someone else"); expand on tap.
  No new component — reuse `Card` + `Chip`/button already imported there.

Colors, tokens, `press`/`press-soft` interactions, and statuses
(scheduled/live/final only) stay exactly as they are.
