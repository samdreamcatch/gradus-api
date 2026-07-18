## Goal
Put David Wallace (`coach2@test.dev`) into the exact "never-paid coach who just lost club coverage" state so landing on `/coach/paywall` triggers the WELCOME_BACK auto-stash + pre-fill flow, with no custom dialog.

## Steps

1. **Clean up Stripe sandbox for David**
   - Look up his current `stripe_customer_id` on `coach_profiles`.
   - Cancel any active/trialing subscriptions on that customer.
   - Delete the Stripe customer in sandbox so no payment method / history remains.

2. **Reset his DB profile to "never paid"** (migration on `coach_profiles` where `user_id` matches David):
   - `stripe_customer_id = NULL`
   - `stripe_subscription_id = NULL`
   - `stripe_subscription_status = NULL`
   - `subscription_tier = NULL`
   - `subscription_interval = NULL`
   - `current_period_end = NULL`
   - `entitlement = 'pending'`
   - `organization_id = NULL` (already null)
   - `promo_code = NULL` (so the `clearOrganizationLink` path is what stashes WELCOME_BACK, not a leftover)

3. **Trigger the WELCOME_BACK stash via the real code path**
   - Call `clearOrganizationLink` server-side for David so the existing logic in `src/lib/coach-org.functions.ts` runs and stamps `promo_code = 'WELCOME_BACK'` (mirrors what would happen if the club admin removed him).
   - Alternative if invoking the fn is awkward: set `promo_code = 'WELCOME_BACK'` directly in the same migration. Either yields the same visible state on the paywall.

## What you'll see after
Log in as David → navigate to `/coach/paywall` → Coach Pro tier is pre-selected, promo field is pre-filled with `WELCOME_BACK`, and the "3 months free, then $70/mo" discount is visible without typing anything. No new dialog.

## Not doing
- No new welcome dialog component (you confirmed no pop-up).
- No changes to `clearOrganizationLink`, paywall, or WELCOME_BACK coupon — they're already in place from the previous turn.
