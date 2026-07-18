## Problem

`startCoachCheckout` always calls `stripe.checkout.sessions.create({ mode: "subscription" })`, which creates a **new** subscription every time — regardless of whether the coach already has one. That's why your test account ended up with both Coach ($306/yr) and Coach Pro ($714/yr) active simultaneously. Stripe has no built-in "one sub per customer" rule; the app has to enforce it.

## Fix

Split the paywall's "confirm plan" action into two paths based on whether the coach already has an active Stripe subscription.

### Path A — no existing sub (or only canceled): new checkout
Current behavior, unchanged. Embedded Checkout session with `mode: "subscription"`.

### Path B — existing active/trialing/past_due sub: modify in place
New server function `changeCoachSubscription({ priceId, environment })`:

1. Load `stripe_subscription_id` from `coach_profiles`.
2. Resolve the target Stripe price via `lookup_keys: [priceId]`.
3. If the sub is already on that price, return `{ noop: true }`.
4. Call `stripe.subscriptions.update(subId, { items: [{ id: existingItemId, price: newPriceId }], proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" })`.
   - `always_invoice` = immediately generates an invoice for the prorated difference and charges the saved card. Upgrades charge the difference; downgrades issue a Stripe credit balance applied to future invoices.
   - Billing anchor is preserved (next renewal date stays July 18, 2027).
5. Webhook (`customer.subscription.updated`) already updates `subscription_tier`, `current_period_end`, etc. — no changes needed there.

### Downgrade cash refund
You asked for a cash refund on downgrade (Pro → Coach or yearly → monthly). Stripe's `always_invoice` leaves the credit as a customer balance, not on the card. To actually refund to the card:

- After the update call, if the resulting invoice has a **negative** total (credit), call `stripe.customers.retrieveBalance` → then `stripe.customers.createBalanceTransaction` to zero it, and issue `stripe.refunds.create({ charge: <original charge>, amount: <credit in cents> })` against the most recent paid invoice for the old tier.
- Cap the refund at the amount actually paid on the original invoice so we never refund more than collected.

### Paywall UI
- If `entitlement === "paid"` and target tier ≠ current tier: button says **"Switch to Coach Pro"** (or "Downgrade to Coach") and calls `changeCoachSubscription` — no embedded checkout iframe.
- Show a one-line preview under the button: "You'll be charged the prorated difference today. Your renewal date stays the same." (upgrade) or "You'll receive a prorated refund to your card. Your renewal date stays the same." (downgrade).
- On success, invalidate `coach-profile` query and toast confirmation.

### Guard against duplicates from Path A
Even in the "new checkout" path, before creating the session, check for an existing active/trialing/past_due sub on the customer. If one exists, refuse to create a new session and route through Path B instead. This prevents the bug from re-occurring via any code path (e.g. bookmarked paywall link, retry after webhook lag).

## Cleanup of your current test-account duplicates

Cancel the **Coach** ($306/yr) subscription on `coach@test.dev` immediately, no refund. Keep Coach Pro as the active sub. I'll do this via a one-off `stripe.subscriptions.cancel` call in a server-side script — no schema change needed. The webhook will fire and clean up `subscription_tier` automatically, then I'll manually re-set `entitlement = 'paid'` and `subscription_tier = 'coach_pro'` in the DB in case the webhook race leaves it in a weird state.

## Files touched

- `src/lib/coach-checkout.functions.ts` — add `changeCoachSubscription`; add duplicate-guard to `startCoachCheckout`.
- `src/routes/_authenticated/coach.paywall.tsx` — branch CTA on existing sub; call new fn instead of opening embedded checkout when switching tiers.
- One-off cleanup call for the test account's duplicate Coach sub.

No DB migration needed — the webhook handler already writes the right fields on `customer.subscription.updated`.

## Out of scope for this pass

- Club coaches (entitlement `club_covered`) — the paywall already hides the tier picker for them.
- Founding coaches (`promo_free`) — upgrade row is disabled "coming soon" per your earlier decision.
- Card-update flow — that's the Stripe billing portal, already wired in Settings.
