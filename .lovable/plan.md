Add a one-tap "Add to plan" action to the bottom of the move sheet.

### Server

In `src/lib/plans.functions.ts`, add `addMoveToPlan({ planId, moveId })`:
- Verify the plan belongs to the current coach.
- Load the move (name, description, cue, why, defaultTargetKind, defaultTargetValue) — RLS already ensures it's the coach's.
- Compute next `position` (max + 1) for that plan.
- Insert a row in `plan_moves` snapshotting the move fields (`move_id`, `name`, `description`, `cue`, `why`, `target_kind`, `target_value`, `position`).
- Bump the plan's `updated_at`.
- Return `{ planId, planTitle }` for the toast.

### UI — `src/components/coach/move-sheet.tsx`

In the existing footer (only shown when `!isNew && existing`), add a third action on the left: **Add to plan** button (ghost variant, `Plus` icon, same sizing as Duplicate/Archive). Layout becomes: `[Add to plan] [Duplicate] ····· [Archive]`.

Tapping opens a `Popover` anchored to the button:
- Header: small label "Add to a plan".
- Body: list of the coach's plans (reuse the existing `listPlans` query with `kind: "plan"`, status `active`). Rendered as a scrollable `divide-y divide-divider` list of buttons — each row shows plan title, athlete chip (reuse `StatusPill` styling pattern: just title + small `text-text-tertiary` athlete name), matching the plans list visual language.
- Empty state: "No active plans yet."
- Tap a row → calls `addMoveToPlan`, closes popover, toast "Added to {planTitle}", invalidates `["plans"]` and `["plan", planId]` query keys.

All styling uses existing tokens (`bg-popover`, `text-text-primary`, `border-divider`, `divide-divider`). No new design primitives.

### Out of scope

- No duplicate-detection (coach can intentionally add the same move twice).
- No reordering UI in the popover — new row goes to the end of the plan.
- Templates are excluded from the picker; only `kind: "plan"` active plans.
