# Fix: "The athlete (18+)" can't be selected in the email dropdown

## What's wrong

In the schedule-import review step, the "Who should we email?" dropdown doesn't hold its own value — it infers the choice from which email field is filled in. Since that block only appears when the row has no email yet, picking "The athlete (18+)" writes an empty athlete email, the inference still reads "a parent or guardian," and the dropdown snaps back. The choice only appears to stick after an address is typed.

## The fix

Give the dropdown a real value that the coach controls:

- Track the chosen recipient per row in component state, seeded from whichever email came in from the import (athlete email present and no guardian email -> athlete, otherwise guardian).
- Selecting an option updates that state immediately and moves any already-typed address to the matching field, so the selection sticks whether or not an email is entered yet.
- Typing an email writes to the field the chosen recipient points at, as it does today.
- The helper text under the email field becomes recipient-aware: parent/guardian wording for guardian, "adult athletes only" wording for athlete.

No changes to how the import is committed or to the invite emails themselves — the same single address and recipient flag are sent as today.

## Technical detail

`RowSummary` in `src/components/coach/schedule-import-sheet.tsx`: replace the derived `recipient` const with `useState`, and have `onValueChange` set state plus re-file the current address. Everything else in the file stays as is.
