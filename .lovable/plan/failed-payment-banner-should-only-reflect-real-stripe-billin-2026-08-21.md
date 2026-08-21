# Failed-payment banner should only reflect real Stripe billing

## What's actually happening

Alyson's coach record does carry `subscription_status = past_due`, so the banner is technically doing what it was told — but the data behind it is not from her real billing:

- Her row is stamped `subscription_environment = sandbox` (a test-mode subscription, `sub_1Tw5…`), created without a card, which Stripe naturally moved to `past_due`.
- She is a founding coach with lifetime-free access, so no payment is owed at all.
- The banner reads only `subscription_status` and ignores the environment, so a leftover test subscription surfaces as a real failed-payment warning on the live app.

## The fix

**1. Environment-scope the billing banners**
- Expose `subscriptionEnvironment` on the coach profile payload.
- `PaymentIssueBanner` and `TrialCardBanner` in `src/routes/_authenticated/coach.tsx` render only when that environment matches the environment the running build is on (`getStripeEnvironment()`). A sandbox subscription can never warn on the live app, and vice versa.

**2. Don't warn coaches who owe nothing**
- Suppress the banner when the coach has free access: founding coach on `promo_free`, or `entitlement = club_covered`. These coaches have no live invoice to fix, so a "your payment failed" prompt is always wrong for them.

**3. Confirm against Stripe before warning**
- When a coach is `past_due`/`unpaid` in the matching environment, verify the subscription's current status with Stripe on the profile read (same lazy pattern already used for `trialNeedsCard`) and pass a `billingPastDue` boolean. Stale DB rows from missed webhooks stop producing phantom banners; the banner shows only when Stripe agrees.

**4. Clean up the stale test record**
- Clear the sandbox subscription fields on Alyson's coach profile (status, subscription id, environment, tier) so her account reflects her actual founding-coach state.

## Technical notes

- `src/lib/coach-profile.functions.ts`: add `subscriptionEnvironment` and `billingPastDue` to `CoachProfileDTO`; compute `billingPastDue` only when the stored status is `past_due`/`unpaid`, the environment matches the server's Stripe env, and Stripe's live retrieve confirms the status. Any Stripe error → `false` (fail quiet, never warn on uncertainty).
- `src/routes/_authenticated/coach.tsx`: `PaymentIssueBanner` gates on `profile.billingPastDue`; `TrialCardBanner` additionally gates on the environment match.
- `src/routes/_authenticated/coach.settings.tsx`: same suppression where plan status text mentions a payment problem.
- Data cleanup runs as a one-off scoped update on her `coach_profiles` row.
