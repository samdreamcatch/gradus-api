
## Goal

1. Make `/coach/paywall` visually + behaviorally identical to `/dev/paywall-preview`.
2. Turn the paywall on (`VITE_COACH_PAYWALL_ENABLED=true`) so onboarding's existing `navigate({ to: "/coach/paywall" })` actually renders it instead of redirecting to `/coach/roster`.
3. Gate **multiple sports** behind Coach Pro / Club. Coaches on the free "Coach" tier can pick exactly **one primary sport** plus, optionally, **Strength & Conditioning** as a secondary.
4. Adjust the onboarding order of operations so a coach's tier intent is known before they pick sports — otherwise they'd hit a wall retroactively.

## Order-of-operations decision

Currently onboarding is: `path → profile → levels → hours → invite → review`, then `/coach/paywall` runs as a separate route.

Problem: sports/levels come **before** the paywall, so we can't gate the sport picker on tier without pushing the tier decision earlier.

Proposal: insert a lightweight **Plan step** for individual coaches right after `path`, so club coaches skip it entirely.

New order:
```text
path → (individual only) plan → profile → sports/levels → hours → invite → review → /coach/paywall (checkout)
```

- The in-flow **Plan step** is a *tier intent* choice (Coach vs Coach Pro), not payment. It sets local state used to gate the sport picker.
- The final `/coach/paywall` route is still where the card is entered. It reads the chosen tier + any promo code carried through from `path` and pre-selects the matching plan card.
- Club coaches (`path === "club"`) skip both the plan step and the paywall (they already do).
- Founding-coach promo path is unchanged — `entitlement=promo_free` still bypasses `/coach/paywall`.

## Sport picker gating

`SportMultiselect` currently allows any number of selections. Add a new prop `maxPrimarySports?: number` plus `alwaysAllowedSecondary?: SportKey[]` (default `["strength_conditioning"]`).

Rules when `maxPrimarySports === 1`:
- User can select **one** non-S&C sport. Selecting another swaps the current one (or is blocked with a small inline "Upgrade to Coach Pro to add more sports" affordance).
- `strength_conditioning` is always toggleable regardless of the primary count.
- Custom sport add is disabled (custom = paid feature by definition of "multi-sport").
- Inline CTA "Add more sports — Coach Pro" links to the Plan step / paywall.

Onboarding wires `maxPrimarySports = tierIntent === "coach_pro" ? undefined : 1`.

The same component is used post-onboarding in Settings' sport editor — gate the same way using `effectiveTier` from `coachProfileQueryOptions`.

## `/coach/paywall` = `/dev/paywall-preview`

Port these elements from `dev.paywall-preview.tsx` into `coach.paywall.tsx` verbatim (keeping the real Stripe checkout, entitlement redirects, and server-fn calls in place):

- Layout order: **club-code card at top**, then the **promo-code card** immediately below, then the **Coach / Coach Pro** tier cards.
- Tier cards greyed out when a valid club code is entered (`tiersDisabled` behavior).
- Same copy, same billing toggle (`month` / `year`), same feature bullets, same CTAs, same `PaymentTestModeBanner` placement.
- Same promo-applied state showing "Start N months free" CTA label.

Real-app wiring differences vs the preview:
- Promo validation calls `validatePromoCode` server fn (already imported), not the fake `setTimeout`.
- Tier CTA opens Stripe Embedded Checkout via `startCoachCheckout` (already wired).
- Club-code path calls the existing `claimOrganizationInviteCode` fn and, on success, navigates to `/coach/roster`.
- If arriving with a pre-selected tier from onboarding (`?tier=coach_pro`), pre-highlight that card.

## Flip the flag

Set `VITE_COACH_PAYWALL_ENABLED=true` in the environment. Once true:
- `isCoachPaywallEnabled()` returns true → `/coach/paywall` renders instead of redirecting.
- Onboarding's existing `navigate({ to: "/coach/paywall" })` at line 403 now lands on the real page.
- New signups without a `FOUNDING_COACH` promo will see the paywall; anyone already stamped `promo_free` / `paid` / `club_covered` is unaffected (route checks entitlement first).

## Files touched

- `src/routes/_authenticated/coach.paywall.tsx` — rewrite the UI to match dev preview layout (club-first, promo second, tiers third; greyed tiers when club code present).
- `src/routes/_authenticated/coach.onboarding.tsx` — insert `"plan"` step in `stepOrder` for individuals; pass `maxPrimarySports` to `SportMultiselect`; forward chosen tier via `?tier=` when navigating to `/coach/paywall`.
- `src/components/onboarding/sport-multiselect.tsx` — add `maxPrimarySports` + `alwaysAllowedSecondary` props; render inline "Upgrade" affordance when cap hit.
- `src/components/onboarding/plan-choice.tsx` **(new)** — small tier-intent picker reused between onboarding step and (later) settings.
- Settings sport editor call site — pass `maxPrimarySports` based on `effectiveTier` so the same rule applies post-onboarding.
- `.env` — set `VITE_COACH_PAYWALL_ENABLED=true`.
- Remove `/dev/paywall-preview` **only after** parity is confirmed (leave it in this pass so we can diff).

## Out of scope

- No changes to Stripe products/prices — already seeded.
- No DB migration — sport count isn't enforced server-side today and won't be in this pass (the paywall + UI cap are the enforcement surfaces). Call this out for a later hardening pass if you want a trigger.
