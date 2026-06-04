## Mobile schedule: Day pager

Replace the stacked 7-day list with a single-day view plus a sticky weekday strip.

### Header (sticky, replaces current week-nav card)
- Top row: `‹` chevron, centered week label ("Jun 2 – Jun 8"), `›` chevron. Small "Jump to this week" link below the label when not on the current week (same behavior as today).
- Below it: a 7-cell weekday strip — `M T W T F S S` with the date number underneath (e.g. `2 3 4 5 6 7 8`). Each cell is tappable. The selected day uses the accent fill; today gets a subtle ring/dot when not selected. Cells whose day has zero sessions render at lower opacity so the eye is drawn to days with activity.

### Body (single day at a time)
- Big day header: `Monday` (font-display) + `Jun 2` muted, plus a "Today" pill when applicable and a session count chip ("4 sessions" / "Rest day").
- Below: session list for that day only. Each row is full-width with:
  - Left: start time in big tabular numerals (`4:00p`).
  - Right: full athlete name (no truncation needed at this width) + a small `4:00p – 5:00p` range underneath in muted text.
- Empty day: centered message ("Rest day — no lessons scheduled") with no list.

### Navigation
- Tapping a weekday cell switches the day without changing the week.
- Tapping `‹` / `›` moves the whole week by 7 days; the selected day stays the same weekday (e.g. if Wed was selected, next week's Wed becomes selected).
- Default selection on first render: today if today is in the visible week, otherwise the first day of the visible week.
- Optional polish: horizontal swipe on the body to advance the day (cross-week when you go past Sun/before Mon). Out of scope unless trivial.

### Sport filter
- The existing sport chip row above the tabs continues to filter the dataset; the day view recomputes from the filtered set.

### Out of scope
- Real per-date data (we still render the recurring weekly slots projected onto the visible week's dates — same data model as today).
- Editing sessions, athlete detail.

### Technical notes
- Single file: rewrite `src/components/coach/week-schedule-view.tsx`. No other files change.
- State: `weekStart: Date` (Monday) and `selectedDayIndex: 0..6` (Mon..Sun). Derive `selectedDate = addDays(weekStart, selectedDayIndex)`.
- Reuse the existing date helpers (`startOfWeekMonday`, `addDays`, `sameDay`, `formatTime`, `MONTH_SHORT`, `DAY_LONG`).
- Build `sessionsByDay: Map<0..6, DaySession[]>` once per `athletes` change; the body just reads `sessionsByDay.get(selectedDayIndex)`.
- Weekday strip: render `DAY_SHORT[(weekStart.getDay()+i)%7 ...]` — or simpler, hardcode `['M','T','W','T','F','S','S']` and compute the date number from `addDays(weekStart, i).getDate()`.
- Dim empty cells via `opacity-50` when `sessionsByDay.get(i)!.length === 0`.