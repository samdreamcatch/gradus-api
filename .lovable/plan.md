## Problems

1. **iOS auto-zooms when focusing an input.** Safari zooms the viewport whenever a focused input/textarea/select has a computed font-size under 16px. Several of our fields (inline `MoveField` text inputs that inherit `text-sm`, the move-picker search `Input` which is `text-base` on mobile but `md:text-sm`, number/target inputs in `move-sheet.tsx`, etc.) trigger this on phones. The page itself doesn't move — the browser zooms.

2. **Move search list hides behind the keyboard.** The "Add moves" sheet (`SheetContent side="bottom"` with `max-h-[85vh]`) is sized against the full visual viewport. When the iOS keyboard opens, the sheet doesn't shrink, so the filtered list scrolls underneath the keyboard and items can't be tapped.

## Plan

### 1. Prevent input zoom globally

Edit `src/routes/__root.tsx` viewport meta from:
```
width=device-width, initial-scale=1
```
to:
```
width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content
```

- `maximum-scale=1` stops Safari's focus-zoom without us having to audit every input's font-size.
- `interactive-widget=resizes-content` (iOS 16+/Chrome) makes the layout viewport shrink when the soft keyboard opens, so `vh`/`dvh`-based layouts adapt automatically.
- `viewport-fit=cover` is a no-op for this issue but is the standard partner setting and keeps safe-area insets working.

This is the lightest-touch fix that addresses every input across the app in one place and matches what the user described ("the display should not move").

### 2. Make the move-picker sheet keyboard-aware

In `src/routes/_authenticated/coach.plans.$planId.tsx`, the move-picker `SheetContent` (around line 1141):

- Swap `max-h-[85vh]` for `max-h-[85dvh]` so the sheet honors the dynamic viewport once the keyboard is open (combined with `interactive-widget=resizes-content` above, the sheet shrinks instead of letting the list slide under the keyboard).
- Keep the existing flex layout: header + sticky search row on top, `flex-1 overflow-y-auto` results list in the middle, footer actions pinned at the bottom. Confirm the `<ul>` keeps `flex-1 overflow-y-auto` (it does today) so the list — not the page — is what scrolls.

No other UI restructuring; the search input stays at the top of the sheet where it already is, and the list below it remains scrollable within the shrunken sheet.

### Out of scope

- No font-size changes on individual inputs (the viewport meta covers it).
- No changes to server functions, data, or styling tokens.
- Other bottom sheets aren't reported as broken; leaving them alone unless the same pattern shows up later.
