# Align /coach/resources with /parent/resources

## Goal
`/coach/resources` should be visually and structurally identical to `/parent/resources` — same header, segmented toggle, sport select, search input, grouped `ResourceList`, `ResourceSheet`, and empty states. The coach-only capability (uploads) becomes a small, unobtrusive affordance layered on top rather than a distinct layout.

## What changes

### 1. Rewrite `src/routes/_authenticated/coach.resources.index.tsx`
Copy the structure of `parent.resources.index.tsx` verbatim (same JSX shell, same class names, same components, same order):

- `PageTitle "Resources"`
- `FilterBar` with `SegmentedToggle` — options: **Library**, **Ask Gradus**, **Saved** (same three tabs as parent). Sport `Select` appears only when `sports.length > 1`, styled identically (`h-8 rounded-full ... text-xs font-bold`).
- Library view: same `Search` input, same grouped rendering — "From your coaches" (the coach's own uploads) above "Gradus library", both rendered by the shared `ResourceList` sub-component and opened via the shared `ResourceSheet`.
- Ask Gradus and Saved views: reuse `AskGradusCard` and `SavedAnswersList` — extract them from `parent.resources.index.tsx` to keep parity.
- Same empty states, same loading copy, same `mx-auto max-w-2xl px-4 pt-6 pb-24` shell.
- Bottom nav swapped to `CoachBottomNav`.

### 2. Extract shared sub-components
Move `AskGradusCard`, `SavedAnswersList`, `ResourceList`, `ResourceSheet`, and `KindIcon` out of `parent.resources.index.tsx` into a new `src/components/resources/` module so both pages import the exact same code. Parent page becomes a thin wrapper; coach page imports the same primitives. This guarantees visual parity going forward.

### 3. Unify the data shape
Extend `listCoachResources` in `src/lib/coach-resources.functions.ts` to return the same `ResourceDTO[]` shape as `getParentResources` (single `resources` array with `source: 'coach' | 'library'`), so the coach page can feed the shared `ResourceList` with no branching. Keep `canUpload` and `effectiveTier` on the DTO for the upload affordance.

### 4. Subtle upload affordance (coach-only)
Instead of the current large dashed "Add a resource" card, add a small **+ icon button** at the right edge of the `FilterBar` row (aligned with the segmented toggle), sized to match the sport Select pill (`h-8 rounded-full`, `bg-card border border-divider`, accent icon).

- **Pro / Club:** button is enabled and opens `UploadResourceSheet`. Also render a small trailing "Delete" affordance on the coach's own rows inside `ResourceList` (only when the row is `source: 'coach'` **and** the viewer is the owning coach — pass an `onDelete` prop).
- **Coach (free):** button renders in a locked/disabled state with a `Lock` icon and a small "Pro & Club" pill in a `Popover` explaining the gate — reuses the same pattern as `also-coached-by-list`'s locked state. No large upsell card on the page.

Everything else on the coach page looks pixel-identical to the parent page.

## Technical details

- New files: `src/components/resources/ask-gradus-card.tsx`, `saved-answers-list.tsx`, `resource-list.tsx`, `resource-sheet.tsx`, `kind-icon.tsx` (moved from parent route). No behavior change for the parent route.
- `src/lib/coach-resources.functions.ts`: reshape `CoachResourcesDTO.resources` to match `ResourceDTO` (add `source`, `sports[]`, `coachName`, `externalUrl`); keep `canUpload` and `effectiveTier`.
- `src/routes/_authenticated/coach.resources.index.tsx`: full rewrite based on parent route.
- `src/components/coach/upload-resource-sheet.tsx`: no changes.
- No database, RLS, or server-fn security changes.

## Out of scope
- No changes to Ask Gradus or Saved Answers behavior.
- No changes to storage policies or upload validation.
- No changes to the parent route's UX (only refactor of internal imports).
