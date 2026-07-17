## Goal

Bypass the coach paywall entirely until we're ready to enable billing. Anyone who signs up during this window becomes a **Founding Coach** — free forever, never billed, even after the paywall goes live for future signups.

## Approach

Add a single env flag `VITE_COACH_PAYWALL_ENABLED` (default `false`). While the flag is off:

### 1. Route guard — `src/routes/_authenticated/coach.tsx`
Drop the paywall redirect. Onboarding redirect stays. An onboarded coach with any entitlement value goes straight into the app.

### 2. Onboarding completion — `src/lib/coach-profile.functions.ts`
In `completeOnboarding`, when the flag is off, also set:
- `entitlement = 'promo_free'` (already in the `ENTITLED` set — no schema change needed)
- `promo_code = 'FOUNDING_COACH'`

`promo_free` + `FOUNDING_COACH` is the durable marker of the cohort. Nothing later reads the env flag to decide access — once stamped, they're free forever regardless of whether the paywall gets turned on for new signups.

Add a one-time backfill in `ensureProfile`: any existing coach still on `entitlement = 'pending'` gets upgraded to `promo_free` + `FOUNDING_COACH` on their next profile read.

### 3. Paywall route — `src/routes/_authenticated/coach.paywall.tsx`
When flag is off, silent redirect to `/coach/roster`. No UI. (Chosen because we never shipped a build with this URL.)

### 4. Settings plan card — `src/routes/_authenticated/coach.settings.tsx`
When the coach's `promo_code = 'FOUNDING_COACH'`, show:
- Plan name: **Founding Coach**
- Status pill: **Free — lifetime**
- Description: short line thanking them for being early
- **Hide** all billing CTAs: no "Manage billing", no upgrade buttons, no billing-portal link
- **Keep** the "Join a club" flow — a founding coach can still become part of a Gradus club just like an individual paid coach can, at which point their org relationship takes over the same way it does today

The billing-portal button, past-due banner, and every other paid-subscription surface remain in the codebase and continue to work for anyone whose `promo_code` is NOT `FOUNDING_COACH`. Founding coaches simply never see them.

### 5. Migration
Add a `FOUNDING_COACH` row to `promo_codes` (label "Founding Coach", `percent_off = 100`, `active = true`) so the cohort is queryable and consistent with how other promo codes are represented.

### 6. Env
`VITE_COACH_PAYWALL_ENABLED=false` in `.env` and `.env.development`.

## What is NOT changed (payments infra preserved)

Nothing about Stripe is deleted or refactored:
- `src/lib/stripe.ts`, `stripe.server.ts`, `coach-checkout.functions.ts`
- Webhook route `/api/public/payments/webhook`
- `coach_profiles` billing columns (`stripe_customer_id`, `subscription_tier`, `subscription_status`, `trial_ends_at`, `current_period_end`)
- Price catalog (`coach_monthly` / `coach_yearly` / `coach_pro_*`)
- Billing portal, past-due banner, checkout embed
- The paywall page's pricing UI (it still exists in the file; it's just gated behind the flag)

Re-enabling: set `VITE_COACH_PAYWALL_ENABLED=true` and redeploy. New coaches will go through checkout again. Founding coaches already stamped stay free forever because access is decided by `entitlement`, not by the flag.

## Files touched

- `src/routes/_authenticated/coach.tsx` — remove paywall redirect when flag off
- `src/routes/_authenticated/coach.paywall.tsx` — redirect to `/coach/roster` when flag off
- `src/routes/_authenticated/coach.settings.tsx` — Founding Coach plan card, hide billing CTAs when `promo_code = 'FOUNDING_COACH'`
- `src/lib/coach-profile.functions.ts` — auto-stamp Founding Coach in `completeOnboarding`; backfill in `ensureProfile`
- one migration inserting the `FOUNDING_COACH` promo_codes row
- `.env`, `.env.development` — add `VITE_COACH_PAYWALL_ENABLED=false`
