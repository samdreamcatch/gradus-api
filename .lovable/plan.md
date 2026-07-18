## Problem

When an already-entitled coach lands on `/coach/paywall?tier=...` via an "Upgrade" affordance, the page shows the "Manage your plan" view but has no exit. The only way off is to actually buy a new plan — a coach who decides to stick with their current plan is stuck.

## Fix

Add a "Keep my current plan" action to the "Manage your plan" view that returns the coach to where they belong:
- If `onboardedAt` is null → `/coach/onboarding`
- Otherwise → `/coach/roster`

### Where it appears

In `src/routes/_authenticated/coach.paywall.tsx`, inside the plan-picker render (not the embedded-checkout render), shown **only when** `isEntitled === true` and the coach isn't in the middle of Stripe checkout (`clientSecret` is null). Placed as a full-width secondary button beneath the tier cards, visually subordinate to the "Subscribe" CTAs so it doesn't compete with the upgrade path.

Copy: "Keep my current plan" (button), with helper text underneath like "No changes — return to your workspace."

### Behaviour

On click:
1. Navigate with `replace: true` to `/coach/onboarding` or `/coach/roster` based on `onboardedAt`.
2. No server calls, no entitlement mutation — the coach's existing plan is untouched.

## Files touched

- `src/routes/_authenticated/coach.paywall.tsx` — add the "Keep my current plan" button in the entitled-view branch.

## Out of scope

- The unentitled/first-time flow (the redirect from onboarding to paywall for `pending` coaches) is unchanged — that gate is intentional.
- No changes to Stripe, entitlement values, or the current-plan banner.
