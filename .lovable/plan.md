## Problem

`ResizeObserver loop completed with undelivered notifications` is a benign browser warning that bubbles up to `window.onerror` and gets logged in the admin error panel. It does not crash the UI or block users, but it currently appears 18 times in `/coach/plans` and creates noise in the admin error digest.

The warning comes from Radix UI primitives (Select popper, Sheet/Dialog) combined with synchronous layout updates driven by `useVisualViewport` in the plan editor sheet.

## Plan

1. **Suppress the warning in the client error reporter**
   - Update `src/lib/client-error-reporter.ts` to skip reporting `ResizeObserver loop completed with undelivered notifications`.
   - This is a known browser warning, not an actionable app error, so filtering it matches the reporter's existing goal of avoiding alert spam.

2. **Reduce synchronous layout thrashing from `useVisualViewport`**
   - Update `src/hooks/use-visual-viewport.ts` to batch `setState` updates inside `requestAnimationFrame` and only update when values actually change.
   - This breaks the tight cycle where visual viewport changes → React state updates → DOM size changes → Radix `ResizeObserver` callback → another viewport change in the same frame.

3. **Review visual-viewport-driven inline styles in the plan editor sheet**
   - Inspect `src/routes/_authenticated/coach.plans.$planId.tsx` for inline `maxHeight`/`bottom` styles driven by `useVisualViewport`.
   - Replace the inline `maxHeight`/`bottom` math with CSS-only constraints (`max-h-[85dvh]`, `max-h-[92dvh]`, etc.) where possible, so the browser handles sizing without JavaScript-driven layout recalculation.

## Expected outcome

- The warning stops appearing in `/admin/errors` and the hourly error digest.
- The `/coach/plans` page still behaves correctly on mobile (sheet sizing, keyboard handling, sticky header).
- Reduced risk of similar benign observer warnings from other Radix-heavy routes.