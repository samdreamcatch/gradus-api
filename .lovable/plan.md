Redesign the plan card on `/parent/plans` and `/coach/plans` to lead with a 3-bucket flow-state bar chart of the athlete's logged sessions, with the plan title secondary.

## Card anatomy (within design system)

Built from `Card` primitive + design tokens — no new colors, no new fonts.

```
┌─────────────────────────────────────────────┐
│  Maya · Freestyle practice      12 sessions │
│                                             │
│  ▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓▓     ▓▓▓               │
│  FRUSTRATED 17%  CONTROL 67%  FLOW 17%      │
└─────────────────────────────────────────────┘
```

- Athlete first name in `text-text-secondary`, separator dot, plan title in `font-display font-bold text-text-primary`.
- Right side: `N sessions` in `text-text-tertiary text-xs`.
- Three equal-width pill bars (`rounded-full`, ~8px tall), small gaps between:
  - **Frustrated** → pen-orange fill on pen-orange-wash track
  - **Control** → pen-pool fill on pen-pool-wash track
  - **Flow** → pen-tennis fill on pen-tennis-wash track
- Fill width = bucket %. 0% → empty track.
- Below each bar: label (`text-[10px] font-black uppercase tracking-widest`) and % (`text-xs font-bold tabular-nums`) using the matching `-ink` ink color.
- Whole card is a `Link` to plan detail; subtle hover lift retained.

## Bucket math (5-point → 3 buckets)

The plan detail uses `Frustrated · Pushing · Steady · Locked In · Flowing`. Collapse to:
- **Frustrated** = Frustrated
- **Control** = Pushing + Steady + Locked In
- **Flow** = Flowing

Percentages are integer-rounded with largest-remainder so they sum to 100.

## Data

Session feedback isn't persisted yet (the modal only toasts). For this experiment:

- Add `sessionsByState: { frustrated; pushing; steady; lockedIn; flowing }` and `sessionsTotal` to both `ParentPlanSummaryDTO` (`parent-plans.functions.ts`) and `PlanSummaryDTO` (`plans.functions.ts`).
- Populate from a deterministic stub derived from `plan.id` (hash → counts in [0,30]) so every plan renders a stable, non-empty chart. Marked `// TODO(sessions)` for easy swap once the table exists.
- Empty state (0 sessions): show empty tracks + `No sessions logged yet` in `font-hand text-text-tertiary`.

## Components

- New `src/components/plans/flow-state-bars.tsx` exporting `<FlowStateBars counts={…} />`. Used by both parent + coach cards.
- New `src/components/plans/plan-card.tsx` with the card markup. Parent/coach route files use this shared card with their own `to` route.

## Files touched

- `src/components/plans/flow-state-bars.tsx` (new)
- `src/components/plans/plan-card.tsx` (new)
- `src/lib/parent-plans.functions.ts` (DTO + stub counts)
- `src/lib/plans.functions.ts` (DTO + stub counts)
- `src/routes/_authenticated/parent.plans.index.tsx` (swap local `PlanCard` for shared; drop the move-count/min row — chart carries the meaning; keep muted opacity for benched)
- `src/routes/_authenticated/coach.plans.tsx` (swap `PlanRow` markup for shared `PlanCard`; keep swipe-to-delete wrapper)

## Out of scope

- Persisting session feedback (separate task; flagged with TODOs).
- Filter chips, status pills, athlete switcher — unchanged.
- Plan detail screen — unchanged.