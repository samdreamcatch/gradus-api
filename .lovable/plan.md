## Goal

Make the coach's day schedule scan as a real time-ordered agenda. Keep all copy, fields, and functionality identical — restructure visual hierarchy only, using existing design tokens.

## Scope

Edit only `src/components/coach/week-schedule-view.tsx`. No token changes, no new files, no copy/content changes, no functionality changes.

## Changes

### 1. Day-header container (lines ~218–238)
- Keep the outer `bg-card` wrapper, but drop the heavy rounded panel feel: tighten to a clean header band with a stronger bottom rule (`border-divider` instead of `divider/60`), and add a hair more vertical breathing room (`py-4`).
- No copy changes.

### 2. Schedule body — add a timeline spine
- Replace the `<ul className="divide-y …">` with a `<div className="relative px-4 py-5">` containing:
  - An absolutely positioned vertical rail: `absolute left-[2.25rem] top-4 bottom-4 w-px bg-divider`.
  - A `<ul className="relative space-y-4">` of lesson items.
- Rest-day empty state stays unchanged.

### 3. `LessonRow` — gutter + card
Restructure into a two-column row:

```text
[ time   ]   ┌──────────────────────────────┐
[ gutter ]   │ Athlete name      [chip]    │
             │   (expanded body inside)     │
             └──────────────────────────────┘
```

- Outer `<div className="flex gap-4">`.
- Left gutter `w-10 pt-1`: two stacked labels using `formatTime(startMinute)` over `formatTime(endMinute)`. Top label `text-text-primary`, bottom `text-text-tertiary`. Both `text-[10px] font-bold tabular-nums`. This replaces the inline "11A — 12P" row inside the card.
- Right card: `flex-1 rounded-xl bg-card` with a contrast-led border:
  - **Expanded**: `border border-text-primary/80 shadow-card` (ink-weighted outline so the active lesson reads as primary).
  - **Collapsed**: `border border-divider` only, no shadow; athlete name uses `text-text-primary/85` to recede slightly.
- Header button keeps the same `onClick`/`aria-expanded` toggle. Inside the button, remove the time range line (now in the gutter); show only the athlete name + `StatusChip`, vertically centered when collapsed.
- Expanded body (`PracticeMetric`, `PracticeFooter`, View athlete button) renders unchanged inside the card with current `px-4 pb-4` padding.

### 4. Footer caption (line ~260)
- Wrap the existing caption in a small flex row with a 6px accent dot (`bg-accent`) preceding the text, matching the timeline-spine motif. Same copy.

## Out of scope

- No changes to `PracticeMetric`, `PracticeFooter`, `StatusChip`, `PreLessonBriefing`, week strip, or any data/loaders.
- No new tokens, fonts, or copy. No motion changes beyond existing transitions.
- No mobile/desktop breakpoint changes — current layout is already mobile-first and the spine reads identically wider.

## Verification

- Visual check at 390px: day header → spine with two time stamps in the gutter → expanded ink-bordered card with metric/footer/button → collapsed muted card. Clicking either card still toggles expand. View athlete still calls `onSelectAthlete`.
