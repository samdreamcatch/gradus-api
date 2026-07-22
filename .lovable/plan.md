Confirmed context: until September 1, no coaches enter payment info. The Stripe checkout still creates a subscription for eligible coaches (founding coach or a promo code with `card_required = false`), but the subscription status is `trialing` rather than `active`. The `trialing` status is already treated as entitled in both the webhook and the paywall logic, so the plan still works.

What currently happens
- The Stripe `return_url` is `/coach/paywall?checkout=return`.
- After the no-card checkout, Stripe sends the coach back to that URL.
- The paywall polls the coach profile every 2 seconds until the webhook (or an optimistic server check) sets `entitlement` to `paid`, then it redirects to `/coach/roster`.
- Right now, because the return page shows the full plan cards before entitlement is detected, it looks like the upgrade failed or looped back to the start.

Proposed fix
1. Update the Stripe `return_url` to include the checkout session ID: `/coach/paywall?checkout=return&session_id={CHECKOUT_SESSION_ID}`.
2. Add a synchronous server function `verifyCheckoutSession` that, given the session ID, fetches the Stripe session and its subscription, and writes the subscription state to `coach_profiles` immediately. This works whether the subscription is `trialing` (no card) or `active` (card charged).
3. Change the paywall return state so it shows only a clear "Processing your subscription…" spinner instead of the plan cards.
4. On arrival at `?checkout=return`, call `verifyCheckoutSession` first, then poll the coach profile for a short grace period to catch any trailing webhook.
5. As soon as entitlement is confirmed, redirect to `/coach/roster` (or `/coach/onboarding` if not onboarded).
6. If verification fails or times out, show a helpful message with a "Return to workspace" button and a prompt to contact support.
7. Keep the normal paywall browsing experience unchanged when coaches navigate there directly without a `checkout=return` parameter.

Why this matters for the no-card period
- Stripe still creates a `trialing` subscription for founding coaches and promo codes, which gives them the same `paid` entitlement as a card-paying coach.
- The webhook may be delayed or may be delivered to a different environment (e.g., production URL while testing in preview). The synchronous verification ensures the coach gets immediate access without waiting for the webhook.
- It removes the confusing "I paid / started the trial but I'm back on the paywall" experience before Sept 1.