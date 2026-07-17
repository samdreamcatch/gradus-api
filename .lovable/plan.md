## Goal

Update `/coach/paywall` and Stripe checkout so pricing/copy matches:
- Coach: $30/mo or $25.50/mo billed yearly (already correct in `PRICE_MAP`)
- Coach Pro: $70/mo or $59.50/mo billed yearly (already correct)
- No free trial by default. Promo codes `WILSON` and `PRACTICE` unlock 3 months free on **Coach Pro only**, credit card required, auto-converts to paid.
- Founding coaches see Coach tier as "Free — Founding" (active) and can still buy Coach Pro.
- Coach Pro flips from "Coming soon" to purchasable.

## 1. Paywall UI (`src/routes/_authenticated/coach.paywall.tsx`)

- Headline → **"Activate your workspace"**. Subcopy → "Pick a plan to get started. Cancel anytime."
- Default CTA on both cards → **"Subscribe"** (was "Start free trial").
- Remove the unconditional "SOON" pill on Coach Pro; keep the accent border to mark it as the featured plan.
- Add a **"Have a promo code?"** collapsible field, visible only when the selected/hovered tier is Coach Pro. Uses existing `validatePromoCode`. On valid Pro-eligible code:
  - Show inline "3 months free with `WILSON` — card required, then $70/mo".
  - CTA changes to **"Start 3 months free"** for the Coach Pro card only.
  - Stash the code in component state and pass it into `startCoachCheckout`.
- Founding coach state (`entitlement === "promo_free"` and `promo_code === "FOUNDING_COACH"`):
  - Render the Coach card in a read-only "Active — Free (Founding)" state with a check-mark, no CTA.
  - Coach Pro card remains purchasable normally.
- Drop the "unlink from current club" / bounce-out logic only if it conflicts; otherwise leave untouched.

## 2. Coach Pro live flag

- Set `VITE_COACH_PRO_ENABLED=true` in `.env` and `.env.development` so `isCoachProAvailable()` returns true; the paywall button and the Settings upgrade row both activate.

## 3. Promo code model (`promo_codes` table + sync)

Current model mints all codes as Stripe `duration: "forever"` percent-off coupons. Add support for "N months free":

- **Migration**: add `duration text` (values `"forever"` | `"repeating"`, default `"forever"`) and `duration_in_months int` (nullable) to `promo_codes`. Backfill existing rows to `forever`.
- Extend the safe SELECT grant to include the two new columns.
- Update `updatePromoCode` / `createPromoCode` to accept the new fields; changing them invalidates any minted Stripe coupon (clear stripe IDs, same as `percent_off` today).
- Update `syncPromoCodeToStripe` to mint the coupon with `duration: row.duration`, and `duration_in_months` when repeating.
- Seed `WILSON` and `PRACTICE` via migration inserts (or upserts): `percent_off = 100`, `duration = "repeating"`, `duration_in_months = 3`, `label = "3 months free of Coach Pro"`. Sync must still be run by an admin from the promo-codes admin page in each environment.

## 4. Checkout function (`src/lib/coach-checkout.functions.ts`)

- Add optional `promoCode` field to `inputSchema`. When provided, look it up under admin (existing pattern), and only accept it if:
  - it's active,
  - `duration = "repeating"` (i.e. a "free months" code — currently that means WILSON/PRACTICE), and
  - `data.priceId` starts with `coach_pro_`. Otherwise return `{ error: "This code isn't valid on the Coach plan." }`.
- Drop the unconditional `trial_period_days: 90`. Trial-like access now comes entirely from the Stripe coupon's `duration_in_months`, which zeroes invoices while keeping the card on file.
- Persist the applied code on `coach_profiles.promo_code` when successfully attached (only if empty) so webhook + settings surface it.
- Keep the existing "profile has a lifetime `percent_off` promo attached" branch as-is for future forever-discount codes.

## 5. Founding coach entitlement (no code change to signup)

Signup already stamps founding coaches with `entitlement=promo_free`, `promo_code=FOUNDING_COACH`. Paywall change in §1 is purely presentational. `isEntitled` still redirects them into the app on load, so we add a small carve-out: allow founding coaches to reach the paywall when they explicitly click "Upgrade to Coach Pro" from settings (existing `?tier=coach_pro` deep link already handles this — verify it still opens Pro checkout without redirecting away).

## 6. QA checklist

- Fresh coach + no code → sees "Subscribe", checkout has no trial, card charged $30 / $25.50 / $70 / $59.50 immediately.
- Fresh coach + `WILSON` on Coach Pro → checkout collects card, invoice $0 for 3 months, then $70/mo.
- `WILSON` typed on Coach tier → validation error, no checkout.
- Founding coach on `/coach/paywall` → Coach card "Active — Founding"; clicking Coach Pro opens checkout as normal.
- Settings "Upgrade to Coach Pro" row is now clickable (not "Coming soon").

## Out of scope

- No changes to signup flow, invite propagation, or webhook handler.
- No new promo-code admin UI beyond the two extra fields on existing forms.
