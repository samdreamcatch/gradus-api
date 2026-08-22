# Compact review step: summary cards with edit-on-demand

The review step currently renders the full edit form for every lesson, so ten lessons is a very long scroll. Replace it with a one-line-per-lesson summary card that only opens into the existing edit form when something needs changing.

## Collapsed card (default state)

Each lesson becomes a compact card, roughly two lines:

```text
Ava Nguyen                                    [pencil] [trash]
Mon · 4:00–4:45 PM · Weekly · Figure Skating
parent@example.com
```

- Line 1: athlete name (bold). If the name is missing, show "Needs a name" in destructive text.
- Line 2: day · time range · repeat · sport (sport shown only when the coach teaches more than one).
- Line 3: the email on file, in secondary text.
- Pencil opens the edit view; trash removes the row (unchanged behavior).
- Rows with validation errors keep the red outline and add a short reason line ("Start time couldn't be read"), so a bad row still stands out while scanning.

## Email required from the card

When neither a guardian nor an athlete email came through the upload, the collapsed card shows an inline email input directly — no need to open the editor:

- Label: "Email needed", with a single input plus a small toggle to mark it as an adult athlete's own email (defaults to parent/guardian).
- The card stays flagged until an email is entered, and import stays blocked, as today.

## Expanded card (edit view)

Tapping the pencil expands that card in place into exactly the current edit form (names, day picker, time, length chips, repeats, sport, both emails), with a "Done" affordance to collapse it again. Only one card is expanded at a time. Cards with errors start expanded on first arrival so the fix is immediate; everything else starts collapsed.

## Other trimming

- Keep the top explainer line and the "N rows need a fix" summary, but make the summary tappable to jump to and expand the first bad row.
- "Add lesson row" adds a row already expanded.

## Technical notes

- All changes are in `src/components/coach/schedule-import-sheet.tsx`: split `ReviewStep`'s per-row body into `RowSummary` and the existing form as `RowEditor`, with an `expandedId` state in `ReviewStep`.
- Summary formatting reuses `formatTimeLabel`, `IMPORT_DAYS`, `IMPORT_FREQUENCIES`, and `getSport`; no new helpers in `src/lib/schedule-import.ts` beyond a small display formatter if needed.
- Validation, matching, and commit logic are untouched.
