# Coach plan page: reorder and collapse the practice log

On the coach plan detail page, the "Logged instances" card currently reads: bars → attribution line → practice log list → AI summary. The summary should come before the log, and the log itself should be collapsed by default.

## New order inside the card

```text
Logged instances        12 sessions
[flow-state bars]
12 sessions · 8 logged by Addie, 4 by Tami
—————————————————————————
Summary (AI)
...summary text...
—————————————————————————
Practice log (12)                    v
  (collapsed by default; tap to expand)
```

## Behavior

- The AI summary block moves directly under the bars/attribution line.
- The practice log becomes a collapsible section: a header row with the "Practice log" eyebrow, the session count, and a chevron that rotates when open.
- Collapsed by default. When expanded, it shows the same list as today (first 5 sessions, with the existing "Show all N" row for longer histories).
- Parent and athlete plan pages stay as they are — this change is coach-only, as requested.

## Technical notes

- Single file: `src/routes/_authenticated/coach.plans.$planId.tsx`. Swap the JSX order of the practice-log block and the summary block, and wrap the log in a toggle driven by new local state (`logOpen`, default `false`) with `aria-expanded` on the header button.
- Reuses existing pieces only: `Eyebrow`, `SettingsList`, `SettingsRow`, `SettingsButtonRow`, and the `ChevronDown` icon already imported in the file. No new components.
