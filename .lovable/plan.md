# Require a card to start any free trial

Every checkout now collects a payment method up front — no more card-free starts. Coaches already mid-trial without a card get nudged to add one before their trial ends.

## What changes

**1. Checkout always collects a card**
- The founding-coach 30-day Coach Pro trial keeps the 30 free days, but the card is collected at signup (`payment_method_collection: "always"`).
- Promo-code redemptions also always collect a card, even for codes stored with `card_required = false`.
- The `card_required` flag stays in the promo system and admin UI, but new codes default to requiring a card and the checkout path ignores a `false` value for now (single constant makes it easy to re-honor later).

**2. Paywall copy**
- Trial CTAs make the card requirement explicit, e.g. under the Coach Pro CTA: "Card required — you won't be charged until your free month ends." Same treatment for promo-driven free months ("...until your 3 free months end").

**3. Existing card-free trials get a nudge**
- Coaches currently in `trialing` with no payment method on file see a banner above coach content (same slot as the existing past-due banner) with an "Add a card" button that opens the Stripe billing portal.
- The banner also appears as a row in `/coach/settings` under the Plan section.
- Nothing is revoked — this is a prompt only. When the trial ends, Stripe's normal behavior applies.

## Technical notes

- `src/lib/coach-checkout.functions.ts`: drop the `payment_method_collection: "if_required"` branches; set `"always"` on every subscription session. Keep `trial_period_days: 30` for the founding Pro trial.
- `src/routes/_authenticated/coach.paywall.tsx`: add the card-required helper line beneath trial CTAs.
- `src/lib/coach-profile.functions.ts`: extend the profile payload with a `trialNeedsCard` boolean — true when `subscription_status === "trialing"` and the Stripe customer has no default payment method (checked server-side via the existing admin Stripe client, cached with the profile query).
- `src/routes/_authenticated/coach.tsx`: add a `TrialCardBanner` alongside `PaymentIssueBanner`, reusing `createCoachBillingPortalSession`.
- `src/routes/_authenticated/coach.settings.tsx`: add a "Add a payment method" row in the Plan section when `trialNeedsCard`.
- Admin promo UI: change the `card_required` default for new codes to on; leave existing rows untouched.
