# Make the "Add an athlete" drawer keyboard-safe on mobile

## What's happening today

The drawer on `/coach/roster` is a bottom sheet pinned to `bottom: 0` with `max-h-[85dvh]`. On iOS the on-screen keyboard does not shrink that measurement, so when a coach taps First name, Birthday, or the guardian email field, the bottom of the sheet — including the "Add athlete" button — can end up hidden behind the keyboard.

Other sheets in the app already solve this. "Join a club" and the move sheet size themselves against the live visual viewport, so they float above the keyboard. The add-athlete drawer was never given the same treatment.

## The fix

Apply the existing keyboard-aware pattern to the add-athlete drawer:

- Read the live viewport with the existing `useVisualViewport` hook on the roster page.
- Offset the sheet by the keyboard inset and cap its height to ~90% of the visible viewport instead of `85dvh`, matching "Join a club".
- Keep the sheet body scrollable so the form can still be reached when the keyboard takes up most of the screen.

No new components, no design changes — same surface, same content, just correct sizing.

## Technical notes

- File: `src/routes/_authenticated/coach.roster.tsx`, the `SheetContent side="bottom"` at the add-athlete sheet.
- Replace `max-h-[85dvh]` with `style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}` using `useVisualViewport()` from `@/hooks/use-visual-viewport`, mirroring `src/components/coach/join-club-sheet.tsx`.
- Retain `paper-surface` and `overflow-y-auto` per the bottom-sheet doctrine.
- Verify on a mobile viewport with each of the three hub paths (share / code / manual add) focused into an input.
