## Diagnosis

The plan editor is a bottom sheet sized with `max-h-[92vh]`. On mobile browsers (not installed as a PWA), `vh` measures the **large** viewport — the height with the URL/nav bar collapsed. Since the sheet is anchored to `bottom: 0` and can be up to 92vh tall, its top edge (X button + title row) is pushed above the *actually visible* area and hides behind the browser's URL bar. In an installed PWA there's no collapsible chrome, so `vh` equals the visible viewport and the bug doesn't appear.

## Fix

Swap `vh` for `dvh` (dynamic viewport height) on bottom sheets. `dvh` shrinks in real time as mobile browser chrome shows/hides, so the sheet never exceeds what the user can see. In a PWA there's no chrome to shrink around, so `dvh === vh` and nothing changes. Widely supported (Safari 15.4+, Chrome 108+).

Scoped, non-invasive edits (four files, one class change each):

- `src/routes/_authenticated/coach.plans.$planId.tsx` line 110 — `max-h-[92vh]` → `max-h-[92dvh]` (the bug in the video).
- `src/components/coach/lesson-slot-sheet.tsx` line 222 — `max-h-[90vh]` → `max-h-[90dvh]`.
- `src/components/coach/athlete-detail-sheet.tsx` line 38 — `max-h-[90vh]` → `max-h-[90dvh]`.
- `src/routes/_authenticated/parent.resources.index.tsx` line 445 — `h-[92vh]` → `h-[92dvh]`.

Leaving alone: `src/styles.css` and `src/lib/error-page.ts` (`min-height: 100vh` on full-page layouts is fine — those aren't anchored sheets), and `admin.map.tsx` (`h-[70vh]` in normal document flow, not a bottom-anchored overlay).

No changes to the ScrollToTop pattern from the reference — that solves a different problem (route-change scroll reset), not viewport-unit sizing under mobile browser chrome.

## Why this doesn't degrade the PWA

In standalone mode there's no dynamic browser chrome, so `dvh` and `vh` resolve to the same value. Users on the installed app see zero visual change.
