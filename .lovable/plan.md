# High-leverage audit fixes

Three targeted changes addressing the most impactful findings: a missing h1 on every page that uses `PageTitle`, a needless loading flash on the plan detail pages, and focus-hijacking on mount.

## 1. Fix `PageTitle` and adopt it on hand-rolled titles

**Why:** `src/components/page-title.tsx` currently renders the title in a `<p>`. Every page using it ships with no `<h1>` — bad for SEO and for screen-reader landmarks. Separately, ~8 routes hand-roll their own heading at five different sizes for the same semantic role, so the design system isn't actually being used.

**Changes:**
- In `page-title.tsx`, change the outer `<p>` to `<h1>`. Keep all current classes, the stripe span, and the subtitle `<p>` untouched (visual output stays identical).
- Migrate hand-rolled top-of-page titles to `<PageTitle>` where the visual intent matches the editorial 28px style. Routes to audit and convert:
  - `athlete.index.tsx`, `athlete.plans.index.tsx`, `athlete.messages.index.tsx`
  - `coach.index.tsx`, `coach.plans.index.tsx`, `coach.messages.index.tsx`, `coach.settings.tsx`
  - `parent.index.tsx`, `parent.plans.index.tsx`, `parent.messages.index.tsx`
- **Do NOT touch** the recently-customized centered `text-2xl` titles in `athlete.plans.$planId.tsx` and `parent.plans.$planId.tsx` — those were deliberately styled away from the editorial default. They'll get a plain semantic `<h1>` swap only (no `PageTitle` wrap), so they still contribute an h1 to the page.
- Fix the `coach.onboarding.tsx:198` h1 → h3 skip by demoting the h1 to h2 OR promoting the h3 to h2, depending on which reads as the page's main title.

## 2. Add TanStack route `loader`s to the three plan detail pages

**Why:** `athlete/parent/coach.plans.$planId.tsx` all fetch via `useQuery` on mount, so every navigation shows a "Loading…" flash before the title (the LCP element) paints. A route `loader` priming the query cache lets the title render on the first frame.

**Changes (per route file):**
- Add `loader: ({ params, context }) => context.queryClient.ensureQueryData(planQueryOptions(params.planId))`.
- Extract the existing inline `useQuery({ queryKey, queryFn })` into a shared `queryOptions(...)` factory so the loader and component reference the same key.
- Switch the component from `useQuery` to `useSuspenseQuery` — removes the `isLoading || !plan` branch.
- Add the required `errorComponent` (most already have one) and `notFoundComponent` per TanStack rules.
- Verify `src/router.tsx` already passes `queryClient` through router context (it should — the codebase already uses `useServerFn` + `useQuery` extensively). If missing, wire it.

## 3. Remove stray `autoFocus` outside dialogs

**Why:** `autoFocus` on mount hijacks keyboard and VoiceOver focus on page load — disorienting on mobile and an accessibility regression.

**Changes:**
- `src/routes/signup.athlete.tsx:78` — remove `autoFocus`.
- `src/routes/_authenticated/coach.onboarding.tsx:155` — remove `autoFocus`.
- `src/components/coach/move-field.tsx:286` and `:294` — remove `autoFocus`. (These are inside the inline editor, not a modal Dialog — if the editor opens via a user click and focus management is desired, replace with a `useEffect` + `ref.focus()` gated on the open transition, not mount.)

## Out of scope (deferred)

Items 6–10 from the audit (code-splitting the 1.4k-line coach plan editor, shadow tokens, `dvh` migration, font preconnect, `background-attachment` jank) are lower-leverage and untouched here — happy to follow up in a second pass.

## Verification

- After edits: load each migrated route in the preview, view source / inspect DOM, confirm exactly one `<h1>` per page.
- Navigate to a plan detail page from the list — title should paint with no spinner.
- Tab through the signup/onboarding flows — focus should land on the first natural target (skip link / nav), not jump into a text input.
