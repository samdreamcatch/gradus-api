## Goal
When a coach who was on a Club plan (and never entered a card) leaves the club, automatically grant them a `WELCOME_BACK` code — 3 months free of **Coach Pro**, card required, auto-converts to $70/mo. Same mechanics as `WILSON` / `PRACTICE`.

## Current-state facts (verified)
- `clearOrganizationLink` (src/lib/coach-org.functions.ts:498) sets `organization_id = NULL` and flips `entitlement` from `club_covered` → `pending`. The coach immediately hits `/coach/paywall`. No Stripe customer, no card, no charge if they never paid before.
- `promo_codes` today: `FOUNDING_COACH` (forever), `WILSON`, `PRACTICE` (both 3-month repeating, 100% off, Coach Pro only per notes).
- `coach_profiles.promo_code` already exists (src/lib/coach-profile.functions.ts:73) and is read by the paywall.
- Tier restriction is not a DB column today — it's enforced in checkout logic (`coach-checkout.functions.ts`) and copy in `notes`.

## Changes

### 1. Seed the `WELCOME_BACK` promo code (migration)
Insert a row identical in shape to `WILSON`:
- `code = 'WELCOME_BACK'`
- `label = 'Welcome back — 3 months free of Coach Pro'`
- `notes = 'Auto-granted when a coach leaves a club plan. Coach Pro only. Card required, auto-converts to $70/mo.'`
- `duration = 'repeating'`, `duration_in_months = 3`, `percent_off = 100`, `active = true`

Then run the existing admin "sync coupons to Stripe" flow so `stripe_coupon_id_sandbox` / `stripe_promo_id_sandbox` populate (same as WILSON did).

### 2. Auto-stash the code on leave (server-fn edit)
In `clearOrganizationLink` (src/lib/coach-org.functions.ts:498), when the coach was `club_covered` and has no `stripe_customer_id` (i.e. never paid before), also set:
```
promo_code = 'WELCOME_BACK'
```
Guardrails:
- Only stash if `promo_code` is currently NULL (don't overwrite an existing personal code).
- Only stash if `stripe_customer_id` is NULL (returning ex-paid coaches don't get a fresh 3 months).
- Confirm code is `active = true` in `promo_codes` before stashing (skip silently if disabled).

### 3. Paywall behavior (already works)
The paywall already reads `profile.promo_code` and pre-fills it. Verify:
- The pre-filled code shows the "3 months free of Coach Pro" label.
- The Coach tier is greyed out (WELCOME_BACK is Coach Pro only, matching WILSON handling).
- Coach can clear the code and pay normally if they'd rather skip the freebie.

No new UI is needed if the WILSON pre-fill path already covers this. Confirmed during build; add a small "Welcome back — enjoy 3 months on us" banner above the tier picker only if the existing pre-fill has no visible affordance.

### 4. Checkout enforcement (verify, likely no change)
`startCoachCheckout` already restricts WILSON/PRACTICE to `coach_pro`. Confirm the same Coach-Pro-only gate applies to WELCOME_BACK (it will if the gate keys off `duration = repeating` + notes, or we add WELCOME_BACK to the same allow-list).

## Explicitly out of scope
- No change to what happens when a **paid** coach (had a card, paid individually, then joined a club, then left) leaves — they've already used their intro path. If you want that flow later, we'd add a separate branch.
- No email notification about the freebie (can add later).
- No change to club rejoin flow.

## Answer to your original question, restated
Today: leaving the club drops entitlement to `pending`; the coach lands on the paywall with nothing charged. After this change: they land on the paywall with `WELCOME_BACK` pre-applied, Coach Pro selected, card required, first 3 months at $0, then $70/mo.