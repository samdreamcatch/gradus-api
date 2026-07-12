# Add SportsPoster watermark to first-impression surfaces

Add `<SportsPoster fill opacity={0.08} />` to the surfaces that share the same "brand moment / earned pause" tone as the celebration modal and emails. No layout, copy, or functional changes — watermark only.

## Scope

### 1. Auth screens (page-level background)
- `src/routes/login.tsx`
- `src/routes/signup.coach.tsx`
- `src/routes/signup.parent.tsx`
- `src/routes/signup.athlete.tsx`
- `src/routes/signup.athlete.adult.tsx`
- `src/routes/forgot-password.tsx`
- `src/routes/reset-password.tsx`

Watermark sits behind the auth card, fills the page viewport, clipped by a `relative overflow-hidden` wrapper on the outermost route element.

### 2. Invite landing pages (page-level background)
- `src/routes/i.$code.tsx` (coach invite link)
- `src/routes/p.$token.tsx` (parent/athlete magic link)

Same treatment as auth screens.

### 3. InviteCard (component-level)
- `src/components/onboarding/invite-card.tsx`

Watermark fills the card interior. Applies wherever InviteCard is rendered (roster empty state, Add-to-Roster dialog, onboarding), so the shared invite artifact carries the mark everywhere it appears.

### 4. Empty states (conditional, inside the empty card)
- Roster empty state — `src/routes/_authenticated/coach.roster.tsx` ("No athletes yet" card)
- Plans empty states — coach/parent/athlete plan-list "no plans yet" cards in:
  - `src/routes/_authenticated/coach.plans.index.tsx`
  - `src/routes/_authenticated/parent.plans.index.tsx`
  - `src/routes/_authenticated/athlete.plans.index.tsx`
- Messages empty states — "no conversations yet" cards in:
  - `src/routes/_authenticated/coach.messages.index.tsx`
  - `src/routes/_authenticated/parent.messages.index.tsx`
  - `src/routes/_authenticated/athlete.messages.index.tsx`

Watermark only renders while the empty state is showing; it disappears the moment real data arrives.

## Technical notes

- Every placement uses the existing component: `<SportsPoster fill opacity={0.08} />` inside a `position: relative; overflow: hidden` parent.
- Existing asset (`src/assets/sports-poster.png.asset.json`) is reused — no new uploads.
- Page-level watermarks are added once on the route's top-level wrapper; child sections do not add their own.
- No changes to layout, spacing, copy, buttons, or business logic. Where a route currently has no `relative overflow-hidden` wrapper, add exactly those classes to the existing outermost element.
- Working surfaces stay untouched: roster list (with data), schedule grid, plan detail/editor, messages threads, settings, admin, dashboards.

## Verification

- Visit each listed route in the preview, confirm the watermark is visible at ~8% and clipped to the intended container.
- Confirm empty-state pages show the watermark, then confirm data-populated versions do NOT (by inspecting the conditional branch).
- Typecheck/build passes.
