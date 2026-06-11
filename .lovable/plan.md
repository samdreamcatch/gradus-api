## Problem
In the plan editor sheet (`src/routes/_authenticated/coach.plans.$planId.tsx`), the bottom action row containing **Bench / Delete** + **Activate & share / Update & share / Save template** is rendered as an inline element at the end of the scrollable sheet content (line 812). On mobile, this row sits flush with the bottom of the sheet with no `env(safe-area-inset-bottom)` accommodation, so on iPhones the buttons sit behind the home-indicator gesture area and are hard to tap. It also scrolls off-screen, requiring users to scroll all the way down to reach primary actions.

## Change
In `src/routes/_authenticated/coach.plans.$planId.tsx`:

1. **Action row (line 812)** — promote the inline action row into a sticky footer pinned to the bottom of the sheet:
   - Wrap classes: `sticky bottom-0 -mx-6 mt-4 flex items-center justify-between gap-3 border-t border-divider bg-popover px-6 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]`
   - `-mx-6` + `px-6` makes the divider/background span the full sheet width matching the sheet's horizontal padding.
   - `bg-popover` keeps the bar opaque over the scrolling content (consistent with the existing sticky footer used in the "Save to library" sub-form at line 1435).
   - `pb-[max(env(safe-area-inset-bottom),0.75rem)]` clears the iOS home indicator so the buttons are always tappable.

2. **Scrollable content bottom padding** — add `pb-2` to the content's outer wrapper (`<div className="mt-5 space-y-5">` at line 442) so the last content block doesn't visually touch the new sticky footer's top border.

3. No other structural changes. Sheet sizing (`max-h-[92vh]`), the visual-viewport keyboard handling already in place, and the inner "Save to library & add" sub-form's own sticky footer (line 1435) are unchanged.

## Out of scope
- The athlete and parent plan views (read-only — no action row at risk).
- The move-creation sub-form (line 1435) already has a sticky bottom row and works correctly.
- Desktop layout (sheet is centered with comfortable bottom margin; sticky behavior is harmless there).
- Bottom navigation bar (already adjusted in the previous turn).
