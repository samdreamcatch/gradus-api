In `src/components/coach/week-schedule-view.tsx` (line ~300), change the header count span so that when `selectedSessions.length === 0` it renders nothing instead of "Rest". Non-empty days still show "N LESSON(S)".

The empty-body message ("No lessons scheduled") stays as-is — it's a neutral status, not a presumption of rest.

No other files affected.