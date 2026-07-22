## Goal
1. **Coach Pro 3-month promo codes (WILSON / PRACTICE / WELCOME_BACK)** should not ask for a card at checkout. The first real charge happens after the free months run out.
2. **Founding Coach cohort**: every real (non-test) coach who has already joined, plus any coach who joins before **September 1, 2026**, gets free Coach forever and a one-time, 1-month free Coach Pro trial when they choose to upgrade (no card during the trial).

## Current state
- `startCoachCheckout` already routes to `payment_method_collection: "if_required"` when the promo code has `card_required = false`.
- WILSON, PRACTICE, and WELCOME_BACK are currently `card_required = true` and have no Stripe sandbox promotion codes minted.
- Founding Coach is assigned only when the paywall feature flag is off (`!isCoachPaywallEnabled()`). It is stored as `promo_code = 'FOUNDING_COACH'`, which conflicts with a coach also having a code like WELCOME_BACK.
- The webhook already writes `subscription_status`, `subscription_tier`, and `trial_ends_at`, so a trialing Pro subscription will naturally show as Pro.

## Plan

### 1. Add a source-of-truth `founding_coach` flag to coach_profiles
Create a migration that adds:
- `founding_coach boolean NOT NULL DEFAULT false`
- `founding_pro_trial_used boolean NOT NULL DEFAULT false`
- (optional) `founding_pro_trial_started_at timestamptz`

This lets a coach be a founding coach while still keeping a separate promo code such as WELCOME_BACK.

### 2. Backfill real (non-test) coaches to founding coach
Run a data update that flags every real coach profile that exists today as a founding coach. Test accounts will be excluded by a clear predicate, e.g.:
- Email domains `@test.dev` and `@test.gradus.app`
- The eight dev-switcher accounts (`coach@test.dev`, `coach2@test.dev`, `orgadmin@test.dev`, etc.)

For each real coach:
- Set `founding_coach = true`.
- Set `entitlement = 'promo_free'` if they are not currently `club_covered` or actively paid through Stripe.
- Preserve any existing `promo_code` (e.g., WILCOME_BACK).

You will review the exact email list before we run the update.

### 3. Stamp founding coaches automatically before September 1, 2026
In `completeOnboarding` and `ensureProfile`:
- Replace the `!isCoachPaywallEnabled()` condition with a date check: `new Date() < new Date('2026-09-01T00:00:00Z')`.
- Any coach who is inside the window and has no active paid/club subscription gets `founding_coach = true` and `entitlement = 'promo_free'`.
- Do not overwrite an existing `promo_code` (e.g., WILSON, PRACTICE, WELCOME_BACK).

### 4. Update founding-coach checks in the UI and server functions
Replace `promo_code === 'FOUNDING_COACH'` checks with `founding_coach` checks in:
- `src/lib/coach-profile.functions.ts` (entitlement logic)
- `src/routes/_authenticated/coach.paywall.tsx` (labels, upgrade affordance, redirect logic)
- `src/routes/_authenticated/coach.settings.tsx` (Plan section)
- `src/components/coach/upgrade-to-pro-row.tsx` (navigation)

### 5. Flip the 3-month delayed-first-charge codes to `card_required = false`
Update the promo-code rows so checkout skips card collection:
```sql
UPDATE public.promo_codes
SET card_required = false
WHERE code IN ('WILSON','PRACTICE','WELCOME_BACK');
```
The existing **Card required** toggle in the admin panel is the lever you can flip later when Stripe processing is enabled.

### 6. Mint Stripe Coupon + Promotion Codes in the sandbox environment
Use the existing `syncPromoCodeToStripe` admin action for WILSON, PRACTICE, and WELCOME_BACK in the development environment so the checkout has a real Stripe promotion code to attach.

### 7. Add the founding-coach 1-month Pro trial at checkout
In `startCoachCheckout`, when the coach selects Coach Pro and the profile has `founding_coach = true` and `founding_pro_trial_used = false`:
- Add `trial_period_days: 30` to `subscription_data` (or `trial_end` 30 days out).
- Set `payment_method_collection: "if_required"` because the first invoice is covered by the trial.
- Mark `founding_pro_trial_used = true` and `founding_pro_trial_started_at = now()` on the profile.
- If the coach typed a different promo code (e.g., WILSON), prefer that promo code instead of the founding trial.
- For `changeCoachSubscription` (existing paid coaches switching tiers), do not add a founding trial.

### 8. Webhook handling (no change needed, but confirm)
`customer.subscription.created` / `updated` already writes `subscription_status = 'trialing'`, `subscription_tier = 'coach_pro'`, `trial_ends_at`, and `entitlement = 'paid'`. Because `coach_effective_tier()` returns `coach_pro` when `subscription_tier = 'coach_pro'`, the coach will have full Pro features during the free month.

### 9. UI copy updates
- **Paywall**: for a founding coach upgrading to Coach Pro, show “1 month free, then $70/mo” and “No card required today.”
- **Settings Plan section**: surface the founding status and the “Try Coach Pro free for 1 month” action.

### 10. Test the combined flow
- Verify a new coach before Sept 1 is auto-marked as founding and has free Coach.
- Verify a founding coach can upgrade to Coach Pro and start a 30-day trial without entering a card.
- Verify WILSON/PRACTICE/WELCOME_BACK still give 3 free months on Coach Pro without a card.
- Verify that after the trial/3-month period, the subscription attempts to charge and falls into `past_due` if no card is added.

### 11. Adjustment path when Stripe processing is live
- To require cards at signup for the 3-month codes, toggle **Card required** to `true` for WILSON/PRACTICE/WELCOME_BACK in the admin panel — no code change.
- The founding-coach cutoff date is hardcoded to Sept 1, 2026; if you want to extend or move it to a config table, we can do that in a follow-up.

## Deliverables
- Database migration for the `founding_coach` and `founding_pro_trial_used` columns.
- Data update for the real-coach backfill (test accounts excluded by a reviewable list).
- Code changes in `coach-profile.functions.ts`, `coach.paywall.tsx`, `coach.settings.tsx`, and `coach-checkout.functions.ts`.
- Promo-code data update and Stripe sandbox sync for WILSON/PRACTICE/WELCOME_BACK.
- Verification via test checkout.