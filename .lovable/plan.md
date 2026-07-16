## Goal
Remove Stripe's automatic tax so test-mode checkout works without a head-office address on the sandbox account.

## Change
In `src/lib/coach-checkout.functions.ts`, inside `stripe.checkout.sessions.create({...})`:

- Remove `automatic_tax: { enabled: true }`
- Remove `customer_update: { address: "auto" }` (only needed because of automatic tax)

Everything else (customer resolve, trial, metadata, embedded checkout) stays as-is.

## Follow-up (later)
When ready to collect tax, add a head-office address at Stripe → Test → Tax settings, then re-add the two lines above.
