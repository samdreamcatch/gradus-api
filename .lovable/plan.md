# Phase 2 — Promo code discounts + trial-to-paid conversion

Two related workstreams. Both are additive; nothing in phase 1 has to change first.

---

## Part A — Promo codes carry a real Stripe discount and travel through invites

### Where we are today

- `promo_codes` table stores `code`, `label`, `active`, `notes`. No discount value.
- On signup, the code is stamped on the signer's own profile row (`parent_profiles.promo_code`, `coach_profiles.promo_code`, `athletes.promo_code`) via `applyPromoCodeToMyProfile`. That's attribution only — nothing happens at checkout.
- Invite links (coach ↔ parent ↔ athlete) do **not** carry a promo code. If an athlete types `WILSON` at signup, `WILSON` lands on the athlete row only. When that athlete invites their coach and the coach later signs up, the coach's row has no promo code.
- `startCoachCheckout` creates the Stripe subscription without any `discounts:` or coupon reference.

Result: `WILSON` today = a label in the admin promo dashboard. No money moves.

### What "lifetime percent off" means in Stripe terms

- One-time setup per code: a **Stripe Coupon** with `percent_off: N`, `duration: "forever"`.
- Wrap the coupon in a **Promotion Code** (Stripe's shareable label) so the same `WILSON` string exists on both sides — that's what gets attached at checkout.
- At checkout: pass `discounts: [{ promotion_code: "<stripe promo id>" }]` on `stripe.checkout.sessions.create`. Stripe then applies the discount on every renewal invoice for the life of that subscription.
- Removing/deactivating `WILSON` later does not affect coaches who already redeemed it — their subscription keeps the discount. New checkouts stop honoring it.

### Data model changes

Add two columns to `public.promo_codes`:

```text
percent_off        integer  NOT NULL  CHECK (percent_off BETWEEN 1 AND 100)
stripe_coupon_id   text     NULL      -- populated when the coupon is minted
stripe_promo_id    text     NULL      -- populated when the promo code is minted
```

Keep separate sandbox vs live IDs to avoid mixing envs:

```text
stripe_coupon_id_sandbox / stripe_coupon_id_live
stripe_promo_id_sandbox  / stripe_promo_id_live
```

### Attribution chain (invite → checkout)

Goal: if an athlete/parent types `WILSON` at signup, then invites a coach, that coach's checkout auto-applies `WILSON`.

1. **Stamp promo on invite codes.** Add `promo_code text NULL REFERENCES promo_codes(code) ON DELETE SET NULL` to:
   - `athlete_invite_codes`
   - `parent_invite_codes`
   - `adult_athlete_invite_codes`
   Populated on invite-code creation using the inviter's own stamped `promo_code`. Coach invite codes don't need it (coach is the payer, they already have it on their own row).
2. **Carry through invite acceptance.** When a coach accepts an athlete/parent invite (`resolveInviteCode` / claim endpoints), if the coach's `coach_profiles.promo_code` is still null, stamp the invite's `promo_code` onto the coach row. Never overwrite an existing code — first one wins.
3. **Apply at checkout.** In `startCoachCheckout`, before calling `stripe.checkout.sessions.create`:
   - Look up the coach's `promo_code`.
   - Resolve to `promo_codes.stripe_promo_id_<env>`.
   - If present, add `discounts: [{ promotion_code: stripePromoId }]` to the session payload.
   - If the code exists in our DB but not yet minted in Stripe (admin created it before phase 2 sync ran), silently skip and log — don't block checkout.

### Admin surface (small additions to existing promo admin route)

- On promo-code create/edit: require `percent_off`, then call a server fn `syncPromoCodeToStripe(code, env)` that idempotently creates the Coupon + Promotion Code in both sandbox and live and writes the IDs back.
- Show mint status per env ("Sandbox: minted · Live: not minted").
- Show a redemption counter (query Stripe periodically or on-demand).

### Backfill

- Existing rows with no `percent_off` default to `0` (disabled) and are skipped at checkout until an admin sets a real value. No user impact.
- Existing `parent_profiles.promo_code` / `athletes.promo_code` values keep flowing to newly generated invite codes — no data migration needed.

### Edge cases

- **Coach already subscribed when they later accept an invite carrying a code** — code is stamped for attribution but has no billing effect (Stripe won't retroactively discount an existing subscription).
- **Two invites, two different codes** — first one wins on the coach row; the coach can only redeem one discount.
- **Code deactivated between stamping and checkout** — checkout falls back to full price, code stays on the row for attribution.
- **Sandbox vs live** — always resolve using the env from `startCoachCheckout`'s input; never cross wires.

---

## Part B — Trial → paid conversion, in plain English

### What happens today (already working)

`startCoachCheckout` creates the subscription with `trial_period_days: 90` and Stripe embedded checkout collects the card up front.

Timeline for a coach who signs up on **Jan 1**:

| Day | What happens | What the coach sees |
|---|---|---|
| Jan 1 | Coach enters card in embedded checkout. `$0` charged. Stripe subscription created with `status = trialing`, `trial_end = Apr 1`. Our webhook writes `entitlement = paid`, `subscription_status = trialing`. | "Trial started. You won't be charged until Apr 1." |
| Jan 1 – Mar 25 | Nothing. Coach has full access. | Normal app. Settings shows "Coach plan · trial ends Apr 1". |
| Mar 25 (T-7) | Stripe automatically sends a "Trial ending in 7 days" email if that setting is on in the Stripe dashboard (free to enable). | Email from Stripe. |
| Apr 1 | Stripe attempts to charge the saved card. If it succeeds: subscription flips to `active`, invoice paid, webhook updates our row. Coach keeps access, no interruption. | Receipt email. App unchanged. |
| Apr 1 – Apr 7 (if card fails) | Subscription flips to `past_due`. Stripe retries the card on its own smart schedule (up to 4 attempts, ~1 week). | We show a "Payment failed — update card" banner (need to build). |
| Apr 8 or later (if all retries fail) | Stripe cancels. Webhook flips `entitlement = pending`. App gates paid features and pushes back to `/coach/paywall`. | "Your subscription was canceled." |

So the conversion is **automatic**. The coach doesn't have to "convert" — the card on file just gets charged on day 90. What we're missing is the visibility around that moment.

### What Phase 2 adds around the trial

Small, additive:

1. **Coach settings — Plan section (from phase 1) already shows current tier.** Extend it to show:
   - If `trialing`: "Trial ends {date} — you'll be charged $X on that day."
   - If `past_due`: destructive banner "Payment failed. Update your card in the billing portal." with a direct portal button.
   - If `active` with `cancel_at_period_end`: "Your plan ends {date}. Reactivate anytime."
2. **Enable Stripe's built-in trial-ending email** (dashboard toggle, no code). Coach gets one 7 days out and one 3 days out.
3. **Grace-period banner** at the top of `/coach/*` routes when `subscription_status = past_due`. One clickable line, opens the Stripe billing portal.
4. **Optional: 7-day "trial ending" in-app nudge** on the coach home route, driven by `trial_ends_at` from `coach_profiles`. Dismissible.
5. **No new checkout step.** The card was already captured on day 1. Coaches who want to cancel before Apr 1 use "Manage subscription" (phase-1 portal button) → Stripe portal → Cancel → they keep access until Apr 1, then subscription ends cleanly.

### What if a coach signed up without entering a card

Not applicable today — our embedded checkout always collects the card up front, even during the trial. If we ever wanted a truly card-less trial (`payment_settings: 'if_required'`), that's a separate design decision and would need an explicit "add card to keep your plan" flow before day 90.

---

## Suggested build order

1. Migration: add `percent_off`, `stripe_coupon_id_*`, `stripe_promo_id_*` to `promo_codes`; add `promo_code` FK to the three invite-code tables.
2. Admin: `syncPromoCodeToStripe` server fn + UI to set `percent_off` and mint in both envs.
3. Invite creation: stamp inviter's `promo_code` onto new invite codes.
4. Invite acceptance: propagate `promo_code` onto `coach_profiles` when null.
5. Checkout: attach `discounts` in `startCoachCheckout`.
6. Trial UX: extend phase-1 Plan section with trial/past_due/cancel copy + banner.
7. Turn on Stripe trial-ending emails in the dashboard.

## Out of scope for phase 2

- Multi-code stacking, referral rewards, per-code usage caps, expiring codes.
- Custom in-app dunning (rely on Stripe portal + one banner).
- Retroactive discounts for coaches already subscribed.
