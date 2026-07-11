# Promote "Create new lesson" between calendar and day view

Move the buried `+` add-lesson button in the coach week schedule out of the day-view header and up to its own row between the week-strip card and the selected-day card, using an explicit label.

## Change

In `src/components/coach/week-schedule-view.tsx`:

- Remove the small round `+` icon-only button currently rendered in the day-view header row (next to the `2 LESSONS` count, around line 271–285). The `LESSONS`/`Rest` count stays.
- Insert a new full-width button between the week-strip card (closes around line 238) and the "Selected day" card (opens at line 250), rendered only when `athletes.length > 0` (same gate as today):

  ```tsx
  <button
    type="button"
    onClick={() =>
      setSheetMode({
        kind: "create",
        defaultDayOfWeek: selectedDate.getDay(),
      })
    }
    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-divider bg-card px-4 py-3 text-sm font-bold uppercase tracking-widest text-text-secondary shadow-card transition hover:border-accent hover:text-accent-ink"
  >
    <Plus className="h-4 w-4" />
    Create new lesson
  </button>
  ```

Uses the existing `Plus` import, the same `setSheetMode({ kind: "create", ... })` action, and design-system tokens (`bg-card`, `border-divider`, `text-accent-ink`, `shadow-card`) so it sits comfortably between the two cards without introducing a new visual style.

## Out of scope

- No changes to the day-view card body, lesson rows, or the `LessonSlotSheet` behavior.
- No changes to other schedule surfaces (parent/adult-athlete schedule editors are separate components).
