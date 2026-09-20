# Status check on the monitoring findings

I re-checked all five against the code and database as they stand now.

## Already taken care of

**Double-billing on invoices** — Resolved. The duplicate-request protection now reserves the
request up front instead of checking-then-writing, and the database now carries a per-athlete
uniqueness rule across all invoices (confirmed live), so the same lesson date cannot land on two
invoices.

**Duplicate database change files** — Resolved. The copied files are gone; only one copy of each
change remains.

## Partly improved, still worth hardening

**Voice dictation coming back empty** — Improved but not closed. The first pass now asks the AI for
a strict output shape and repairs what comes back, and the retry asks for a simpler shape rather
than repeating the identical request. But if both passes fail, the coach still gets an empty draft
(the words are saved as a transcript). Remaining gap: no pause between attempts and no fallback to
a second model.

## Still broken

**Monthly / every-other-week lessons show every week** — Confirmed unchanged. The week board still
places every lesson on its weekday in every week and never consults the cadence fields, so it
disagrees with what gets invoiced and reminded.

**Signed-out follows not being recorded** — Confirmed unchanged, and the database currently holds
zero signed-out follows. The save targets a uniqueness rule the database can only apply to
anonymous rows under a condition the request doesn't express, so the write is rejected and the
error is thrown away silently.

## Proposed fixes

1. Week schedule board: use the same occurrence expansion the invoicing and reminder paths already
   use, so a lesson only appears in weeks it actually happens.
2. Signed-out follows: make the anonymous save match a rule the database can apply (insert-then-
   ignore on the real conflict, or a matching full uniqueness rule), and stop discarding the error
   so a failure shows up instead of a silent no-op.
3. Voice dictation: add a short pause before the retry and a fallback to a second model, so a long
   dictation has a real second chance before the coach sees an empty draft.

## Technical notes

- `src/components/coach/week-schedule-view.tsx` `sessionsByDay` currently maps every slot onto
  `addDays(weekStart, dowIndex)`; `expandSlotOccurrences()` in `src/lib/lesson-recurrence.ts` is the
  shared source of truth used by `invoicing.server.ts` and `lesson-reminders.server.ts`.
- `src/lib/board.functions.ts` `setBoardFollow` upserts with
  `onConflict: "device_id,competition_slug,skater_name"`; the only matching index is partial
  (`WHERE device_id IS NOT NULL AND user_id IS NULL`), which PostgREST cannot target — 42P10.
  The caller in `src/routes/board.$slug.tsx` swallows the rejection.
- `src/lib/voice.server.ts` `buildDraft` retries `slotTranscript(ctx, "simple")` immediately on the
  same model; add backoff plus a second model before the `{ moves: [], aiFailed: true }` fallback.
