Problem: when a new founding coach lands on `/coach/paywall` as the first onboarding step, the Coach tier card renders "Active" with no button. Because `entitlement` is still `pending`, the onboarding page keeps redirecting them back to the paywall, so they can't proceed.

Plan:

1. Add a server function to grant the free Coach tier to a founding coach
   - Create `src/lib/coach-checkout.functions.ts` addition: `claimFoundingCoachTier` (POST, `requireSupabaseAuth`).
   - It verifies the coach is `founding_coach: true` and sets `entitlement = 'promo_free'` and `subscription_tier = 'coach'` (or leaves subscription_tier null — Coach is the default effective tier). It should be safe to call idempotently.
   - Return `{ ok: true }` or an error if the coach is not a founding coach.

2. Update the paywall UI so founding coaches can actually select Coach
   - In `src/routes/_authenticated/coach.paywall.tsx`, change the `coachFoundingActive` condition: show "Active" only when the coach is both a founding coach AND already entitled (`entitlement` is `promo_free`/`paid`/`club_covered`).
   - During onboarding (`onboardedAt == null`), show a "Continue" button for the Coach tier instead of "Active".
   - Clicking the Coach tier's Continue button for a founding coach calls `claimFoundingCoachTier`, invalidates the profile query, and redirects to `/coach/onboarding` with `replace: true`.

3. Keep the existing upgrade flows intact
   - Founding coaches who already have entitlement still see "Active" and can browse Coach Pro upgrade.
   - Non-founding coaches continue to see the current Coach/Coach Pro CTAs.
   - The `startCoachCheckout` / `changeCoachSubscription` paths remain unchanged for paid upgrades.

4. Verify the flow
   - Simulate a new coach account (dev panel or fresh signup) with `founding_coach: true` and `onboarded_at: null`.
   - Confirm Coach tier shows "Continue" on `/coach/paywall`.
   - Confirm clicking Continue grants entitlement and redirects to `/coach/onboarding`.
   - Confirm onboarding completes successfully and lands on `/coach/roster`.

Files to edit:
- `src/lib/coach-checkout.functions.ts` — add `claimFoundingCoachTier`.
- `src/routes/_authenticated/coach.paywall.tsx` — adjust tier card state and action handler.

No database changes needed; the existing `coach_profiles` columns (`founding_coach`, `entitlement`, `subscription_tier`) support this.