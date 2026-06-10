## Problem

The viewport meta change (`interactive-widget=resizes-content`) and switching `vh` → `dvh` aren't enough on iOS Safari. iOS does not shrink the layout viewport when the soft keyboard appears, and `dvh` on iOS doesn't account for the keyboard either. The `SheetContent` is `position: fixed; bottom: 0`, so it stays anchored to the bottom of the layout viewport — which is now *behind* the keyboard. The list scrolls under the keyboard exactly as the video shows.

The reliable fix is to drive the sheet's position and max-height from the **VisualViewport API**, which does report the keyboard inset on iOS.

## Plan

### 1. Add a `useVisualViewport` hook

New file `src/hooks/use-visual-viewport.ts`. Subscribes to `window.visualViewport`'s `resize` and `scroll` events and returns `{ height, offsetTop }`. Falls back to `window.innerHeight` / `0` when the API is missing (older browsers, SSR).

### 2. Make the move-picker sheet keyboard-aware

In `src/routes/_authenticated/coach.plans.$planId.tsx` (the `MovePickerSheet` around line 1141):

- Read the visual viewport.
- Compute `keyboardInset = window.innerHeight - (vv.height + vv.offsetTop)` (clamped to `>= 0`).
- Apply an inline style to `SheetContent`:
  - `bottom: keyboardInset` (lifts the sheet above the keyboard)
  - `maxHeight: vv.height * 0.85` (keeps the sheet within the visible area, replacing `max-h-[85dvh]`)
- Keep the existing flex layout: header + search row on top, `flex-1 overflow-y-auto` list, sticky footer — so the *list* is what scrolls inside the visible sheet, not the page.

### 3. Apply the same treatment to the move detail sheet

`src/components/coach/move-sheet.tsx`'s `SheetContent` (currently `max-h-[90vh] overflow-y-auto`) has the same shape and the same bug when editing Cue / Why / Description on iOS. Apply the same `bottom + maxHeight` inline style there so typing into its textareas doesn't push fields under the keyboard.

### Out of scope

- No font-size or input changes — the `maximum-scale=1` viewport rule already handles zoom.
- Other sheets/dialogs aren't reported broken; leave them alone unless the same pattern shows up.
- No changes to server functions, data, or styling tokens.

### Technical notes

- `visualViewport` updates fire on focus, blur, keyboard show/hide, and rotation — covers every relevant case.
- Using inline style (not a Tailwind class) because the value is dynamic per render.
- We don't touch `src/components/ui/sheet.tsx` so other sheets/dialogs keep their current behavior.
