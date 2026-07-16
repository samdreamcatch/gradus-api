## Goal
Wire real payments so individual coaches pick a plan, start a 3-month free trial, and unlock the app. Club-covered and promo_free coaches continue to bypass checkout.

## Plan (Stripe, seamless)

Since you chose Stripe, I'll set up Stripe payments with **tax calculation and collection only** (not full compliance handling — that's a heavier default we don't need for Beta). You can toggle full compliance handling later per-transaction.

### 1. Enable Stripe
Call `enable_stripe_payments`. This creates a test-mode Stripe environment immediately; live payments unlock after account claim.

### 2. Create the two products in Stripe
Using the batch product tool after enable:
- **Coach** — $40/month and $360/year (2 prices, same product)
- **Coach Pro** — $70/month and $630/year (2 prices, same product)
Each with tax code `txcd_10103001` (SaaS - business use) so `automatic_tax` works.

### 3. Extend `coach_profiles` (migration)
Add columns:
- `stripe_customer_id text`
- `stripe_subscription_id text`
- `subscription_tier text` — `'coach' | 'coach_pro' | null`
- `subscription_status text` — mirrors Stripe (`trialing`, `active`, `past_due`, `canceled`, etc.)
- `trial_ends_at timestamptz`
- `current_period_end timestamptz`

Update the `entitlement` derivation: `paid` when `subscription_status IN ('trialing','active')`; otherwise falls back to `pending` (unless `club_covered` / `promo_free`).

### 4. Paywall UI (`coach.paywall.tsx`)
Replace the current invite-only paywall with a tier picker:
- Two cards (Coach / Coach Pro), monthly ↔ yearly toggle (yearly shows "save $120 / $210")
- "Start 3-month free trial" CTA per tier
- Keep the existing club-invite-code input below as a secondary option
- Copy stays: "Get your first 3 months free while Gradus is in Beta"

### 5. Checkout server function
New `createServerFn` `startCoachCheckout({ tier, interval })`:
- Requires auth (`requireSupabaseAuth`)
- Creates/reuses Stripe customer, creates a Checkout Session with:
  - `mode: 'subscription'`
  - `subscription_data.trial_period_days: 90`
  - `payment_method_collection: 'always'` (card required to start trial)
  - `automatic_tax: { enabled: true }`
  - `customer_update: { address: 'auto' }`
  - `success_url` → `/coach/roster?checkout=success`
  - `cancel_url` → `/coach/paywall`
- Returns `{ url }`; client redirects to Stripe

### 6. Webhook handler (`/api/public/stripe/webhook`)
Public server route, verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET`, uses `supabaseAdmin` to update `coach_profiles`. Handles:
- `checkout.session.completed` — link customer + subscription IDs, set tier from price ID
- `customer.subscription.created|updated` — sync `subscription_status`, `trial_ends_at`, `current_period_end`, `subscription_tier`
- `customer.subscription.deleted` — set status `canceled`, entitlement falls back to `pending`

### 7. Routing (already in place)
`coach.tsx` already redirects to `/coach/paywall` when entitlement isn't in the entitled set — no change needed. Club-covered coaches still bypass.

### 8. Post-checkout return
On `/coach/roster?checkout=success`, briefly poll the profile (or wait for webhook) then clear the query. If subscription is `trialing` or `active`, coach lands on roster.

## Out of scope for this pass
- Billing portal (manage/cancel subscription) — can add next
- Yearly ↔ monthly mid-cycle switching
- Coach Pro feature gating (we're only storing the tier; gating specific features comes later)

## What I need from you before building
Just confirm this plan. The only thing that needs your input during the build is the Stripe enable form (email/business name).
