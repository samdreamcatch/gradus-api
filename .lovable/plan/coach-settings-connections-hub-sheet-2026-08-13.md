# Coach Settings: Connections → hub sheet

Bring `/coach/settings` Connections in line with the parent/athlete "Add a coach" hub: a single button that opens a bottom sheet with a short menu, then one focused step at a time with a back arrow.

## What changes

Today Connections is an expandable row that stacks everything at once: a Youth-parents / Adult-athlete toggle, the invite card, a divider, and the "have a code" card.

New behavior:

- Replace the expandable Connections row with a **Connect** button (same placement/styling as "Add a coach" in athlete settings), inside the Coaching group.
- Tapping it opens a bottom sheet titled "Connect".
- Hub menu with two rows:
  - **Invite a parent or athlete** — "Share a link or code"
  - **Enter their code** — "They're already on Gradus"
- Choosing a row swaps in that step with a back arrow, matching the parent sheet exactly.
- The Youth parents / Adult (18+) segmented toggle stays, but lives inside the share step above the invite card.
- Code entry closes the sheet on success.

Nothing about invite generation, codes, or linking logic changes — this is layout only.

## Technical notes

- New `src/components/coach/connect-people-sheet.tsx`, modeled directly on `src/components/parent/connect-coach-sheet.tsx` (same `Step = "hub" | "share" | "code"` state, `useVisualViewport` keyboard sizing, `paper-surface` bottom sheet, `press` rows).
- Steps render the existing `InviteCard` (with `SegmentedToggle` for audience) and `EnterInviteCodeCard` — no new cards, no new primitives.
- `src/routes/_authenticated/coach.settings.tsx`: delete `ConnectionsDisclosure` and render the new sheet trigger under the Coaching group; drop the now-unused imports.
