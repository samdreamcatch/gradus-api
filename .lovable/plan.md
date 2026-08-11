# Fix: "No such customer" when upgrading

## What actually happened

Your `coach@gmail.com` account has one saved payment-customer record, and it lives in the **test** environment. Here is the confirmed sequence from tonight:

- 01:20 UTC — you signed in as `coach@gmail.com` in the Lovable **preview**, which runs in test mode.
- 01:27:10 UTC — an upgrade attempt there created a test-mode customer (`cus_V3Ao…`, email `coach@gmail.com`) and saved it on the coach profile.
- 01:27:50 UTC — you signed in as `coach@gmail.com` on **gradus.training**, which runs in live mode.
- 01:29 UTC — you clicked upgrade there. The app sent the saved *test* customer ID to the *live* Stripe account, which correctly answered "No such customer."

Verified directly against both environments: that customer exists in test and does not exist in live. The mirror-image case is also true — your `mariah@gradussports.com` live customer does not exist in test.

## Root cause

The coach profile stores a single `stripe_customer_id` with no environment scoping. Customer IDs are not portable between the test and live Stripe accounts, so the moment the same account is used in both places, one of them sends an ID the other account has never seen.

Checkout makes this worse by trusting the saved ID unconditionally: it reuses whatever is on the profile and immediately calls Stripe with it, without checking whether the ID belongs to the environment it is talking to. The "manage billing" and "change plan" paths have a partial guard, but it fails the other way — they force the *saved* environment, so on the live site this coach would be sent to the test Stripe account.

This is not specific to a test account. Any coach who touches checkout in preview and then in production hits it, and vice versa.

## The fix

**1. Store one customer per environment.** Add `stripe_customer_id_sandbox` and `stripe_customer_id_live` to coach profiles, backfilling each existing value into the column matching its recorded environment. Keep the current column in place for now so nothing breaks mid-deploy.

**2. Read and write the environment-matching column everywhere.** Checkout, billing portal, plan change, club-join cancellation, and the webhook/sync path all resolve the customer for the environment they are actually operating in. If that environment has no customer yet, they find one by user metadata or create one — the behavior checkout already has for first-time coaches.

**3. Stop forcing the saved environment.** Billing portal and plan change should operate in the caller's environment rather than the stored one, now that the customer lookup is environment-correct.

**4. Self-heal on a missing customer.** If Stripe still answers `resource_missing` for a saved ID, clear that ID and resolve a fresh customer rather than surfacing a raw Stripe error to the coach.

**5. Clean up the affected row.** Move `coach@gmail.com`'s existing test customer into the test column so the preview keeps working, and leave the live column empty so production creates a fresh live customer on the next upgrade.

## Technical notes

- Files: `src/lib/coach-checkout.functions.ts` (checkout, portal, plan change, club leave), `src/lib/coach-subscription-sync.server.ts`, and the webhook route that records `stripe_customer_id`.
- Migration: two nullable text columns on `public.coach_profiles`, plus a backfill using the existing `subscription_environment` value. No grant or RLS changes — the columns sit on a table that already has both.
- `subscription_environment` stays as the record of which environment the *active subscription* is in; it stops being used to pick the customer.
- Environment itself keeps coming from the build's publishable key (`src/lib/stripe.ts`), so preview stays test and gradus.training stays live. That split is correct and is not what needs changing.

## Note on scope

This is a backend/data change, so it goes live as soon as it is applied — before you publish the frontend. The frontend edits to the checkout call sites need a publish to reach production.
