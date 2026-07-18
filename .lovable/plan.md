## What happened

The previous fix prevents *future* duplicate subscriptions through the app path, but it did not remove the duplicate subscriptions that were already created in Stripe for `coach2@test.dev`. That is why the billing portal still shows both Coach Pro and Coach.

I also found one remaining app-side risk: the paywall currently auto-starts checkout when opened with `?tier=coach_pro`, even if the coach already has an active subscription. That should branch into the in-place subscription switch instead of opening a new checkout.

## Plan

1. **Clean up David Wallace’s existing duplicate test subscriptions**
   - Keep the active Coach Pro subscription for `coach2@test.dev`.
   - Cancel the duplicate Coach subscription in the test Stripe environment.
   - Update the backend profile if needed so it points at the surviving Coach Pro subscription.

2. **Fix the remaining duplicate-subscription risk in `/coach/paywall`**
   - Change the `?tier=coach_pro` auto-action to use the same unified action as the buttons.
   - If the coach has an active subscription, it will switch the existing subscription in place.
   - If the coach does not have an active subscription, it will start checkout.

3. **Make billing portal safer for bad historical states**
   - Before opening the portal, detect multiple active subscriptions for the coach’s Stripe customer.
   - If duplicates exist, return a clear error instead of sending the coach to a confusing portal state.
   - For normal state, continue opening the portal as today.

4. **Verify**
   - Confirm the database profile for `coach2@test.dev` shows Coach Pro only.
   - Confirm the portal no longer shows both active subscriptions.
   - Confirm the paywall route no longer starts a second checkout for an already-paid coach.