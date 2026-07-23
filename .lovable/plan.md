What happened (current state from the code)

- The user completed a Coach Pro checkout for a founding-coach test account.
- The paywall was supposed to verify the Stripe session synchronously, update the coach profile, and redirect to `/coach/roster`.
- Instead, the user was left on a blank screen for 30+ seconds and then returned to `/coach/paywall` with `?tier=coach_pro`.
- The `coach_profiles` row for that account still shows `entitlement = 'promo_free'`, `stripe_subscription_id = null`, and no `billing_events` were recorded. This means the Stripe session was never successfully reconciled with the local profile.

Root causes identified in the code

1. `verifyCheckoutSession` swallows its own error. The paywall calls it but only attaches `.catch()` and `.finally()`. If the server function returns `{ error: ... }`, the UI never sees it, so the user just stares at the spinner.

2. `syncCoachSubscription` preserves `promo_free` even when an active subscription is synced. The `preserve` flag treats founding-coach `promo_free` like a club-covered plan, so a successful Coach Pro upgrade leaves `entitlement = 'promo_free'`. That means the UI still labels the user as "Founding Coach — free for life" even though they have a paid/trialing subscription.

3. The return flow is stateless. If the `?checkout=return&session_id=...` query params are lost (refresh, navigation, embedded-checkout quirk), the paywall has no way to recover the verification state. It silently falls back to the normal paywall view.

4. `ensureProfile` can re-stamp a founding coach as `promo_free` on the next read if the subscription is not immediately `active/trialing/past_due`. This creates a race between the Stripe sync and the lazy founding-coach stamping logic.

What I will fix

1. Fix entitlement preservation in `src/lib/coach-subscription-sync.server.ts`
   - Active subscriptions (`active`, `trialing`, `past_due`) always set `entitlement = 'paid'`, even for founding coaches.
   - Preserve `club_covered`/`promo_free` only when the incoming subscription is NOT active.

2. Surface `verifyCheckoutSession` errors in `src/routes/_authenticated/coach.paywall.tsx`
   - Check the resolved result of `verifyCheckoutFn`.
   - If the server returns an error, show a clear error message with a "Return to workspace" button and a "Try again" path.

3. Make the checkout return flow recoverable
   - Store `lastCheckoutSessionId` in `sessionStorage` when a checkout starts.
   - If the paywall lands without `?checkout=return` but the stored session exists and the user is not yet upgraded, keep the spinner and retry verification once.
   - Clear the stored session after successful verification or explicit cancellation.

4. Harden the founding-coach stamp in `src/lib/coach-profile.functions.ts`
   - Do NOT re-stamp `promo_free` if the coach already has a `stripe_subscription_id` or if a checkout verification is in progress.
   - Treat a pending subscription from a checkout as evidence that the user is actively converting, not as a reason to re-grant free access.

5. Add more explicit audit rows for the checkout return path
   - Record a `billing_events` row from `verifyCheckoutSession` when it successfully syncs a subscription, so support and debugging can see what happened without guessing.

6. Verify the founding-coach trial Stripe configuration
   - Confirm that `payment_method_collection: 'if_required'` with `trial_period_days: 30` creates a `trialing` subscription (not `incomplete`).
   - If Stripe returns `incomplete` for a no-card trial, switch to `payment_method_collection: 'always'` or collect a card on the founding trial and document it.

Files to edit

- `src/lib/coach-subscription-sync.server.ts` — entitlement logic
- `src/lib/coach-profile.functions.ts` — founding-coach stamp guard
- `src/routes/_authenticated/coach.paywall.tsx` — error surfacing, return-state recovery, spinner fallback
- `src/lib/coach-checkout.functions.ts` — audit row + session persistence, trial-mode verification

Verification plan

1. Run a checkout as a founding-coach test user in the preview/sandbox environment.
2. Confirm the redirect goes to `/coach/roster` and the profile shows `entitlement = 'paid'` and `subscription_tier = 'coach_pro'`.
3. Confirm `billing_events` has a row for the checkout verification.
4. Confirm the paywall now shows "Coach Pro" as the current plan instead of "Founding Coach — free for life".

After this is implemented, the flow should be: click Continue → Stripe checkout → continue → spinner → roster, with the correct plan reflected in Settings and the paywall.