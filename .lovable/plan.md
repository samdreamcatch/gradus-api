## Fixes to the lesson wrap-up modal

### 1. "Edit plan" button color

Currently the primary "Edit plan" action renders as `AlertDialogAction`, which uses the destructive/primary emphasis reserved for confirming destructive intent. Editing a plan is constructive.

- Change "Edit plan" from `AlertDialogAction` to a standard primary `Button` (default variant), matching the non-destructive tone used elsewhere for "save/continue" style actions.
- Keep "Re-deploy" as `variant="outline"` and "Not now" as `AlertDialogCancel`.
- Same treatment in the multi-pending list drawer (the per-row "Edit" button already uses `Button`, so no change there).

### 2. Track whether the lesson happened

Add a fourth outcome so the coach can record that the lesson did not take place, and store it alongside the existing wrap-up actions.

**Language:** add a button labeled **"Didn't happen"** (with a short helper tooltip/subtext: "Mark this lesson as canceled or no-show"). This avoids blame-laden words like "no-show" as the primary label while still being unambiguous.

**Data model:**
- Extend the `lesson_wrap_ups.action` CHECK constraint and the Zod enum from `('edited', 'redeployed', 'dismissed')` to `('edited', 'redeployed', 'dismissed', 'did_not_happen')`.
- No new table — this keeps a single row per (coach, athlete, lesson_date) and preserves the existing unique constraint that already prevents the banner from re-prompting.
- Record via the same `recordLessonWrapUp` server fn.

**UI placement in the modal:**
- Footer, left side (before "Not now"): a subtle `variant="ghost"` button "Didn't happen".
- Clicking it writes `action: 'did_not_happen'` and closes the modal + banner (same flow as re-deploy — no navigation).
- In the multi-pending list drawer, add a matching small ghost "Didn't happen" button per row, left of "Re-deploy".

### Files touched

- `src/components/coach/lesson-wrap-up-provider.tsx` — swap `AlertDialogAction` for `Button`, add "Didn't happen" handler + button in modal and list drawer.
- `src/lib/lesson-wrap-ups.functions.ts` — extend Zod enum, add `WrapUpAction` type entry.
- New migration — drop and recreate the `action` CHECK to include `'did_not_happen'`.

### Out of scope

- Reporting/analytics surfaces for the new "didn't happen" data (data will be captured now; surfacing in admin/reporting can be a follow-up).
