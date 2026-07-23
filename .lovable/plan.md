## Problem

In `/coach/paywall`, founding coaches who have upgraded to a paid Coach Pro subscription are shown as if they are still on the free Coach plan:

1. The **Current plan** header hardcodes `Founding Coach — free for life` whenever `isFoundingCoach` is true, ignoring their actual paid Coach Pro tier.
2. The **Coach Pro card** is never marked `CURRENT` because the `isCurrentTier` calculation is guarded by `!isFoundingCoach`.
3. The **Coach card** shows the `FOUNDING` badge and an `Active` state for all founding coaches, even when they are on Coach Pro.
4. If a founding coach clicks **Coach** to switch from Coach Pro, the code uses the standard `changeCoachSubscription` path, which would convert them to a **paid** Coach subscription instead of restoring their free founding Coach status.

This makes the paywall look incorrect and creates a billing trap when a founding coach tries to change plans.

## Changes

### 1. Fix current-tier display in the paywall header

In `src/routes/_authenticated/coach.paywall.tsx`, update the **Current plan** banner so it reads from the actual paid tier when the coach has an active paid subscription, while still surfacing the founding identity.

- `paid` + `subscriptionTier === "coach_pro"` + `foundingCoach` → `Founding Coach Pro`
- `paid` + `subscriptionTier === "coach_pro"` (not founding) → `Coach Pro`
- `paid` + `subscriptionTier === "coach"` → `Coach`
- `club_covered` → `Club — <org name>`
- `promo_free` + `foundingCoach` (no paid sub) → keep `Founding Coach — free for life`

### 2. Fix the `CURRENT` badge logic on tier cards

Stop excluding founding coaches from the current-tier check. Use the actual paid tier:

- If `entitlement === "paid"` and `subscriptionTier` is set, mark the matching tier as `CURRENT`.
- If `entitlement === "promo_free"` and `foundingCoach`, mark the **Coach** tier as `CURRENT` (free founding access).
- The Coach Pro card should not show `CURRENT` unless the coach is actually paid on Coach Pro.

### 3. Remove the misleading `Active` / `FOUNDING` state on Coach Pro

For a founding coach on a paid Coach Pro subscription, the Coach Pro card should show the `CURRENT` badge, and the Coach card should no longer show `FOUNDING`/`Active` — it should instead show the standard action button to switch down (if they choose to).

### 4. Add founding-coach downgrade path

When a founding coach with an active Coach Pro subscription chooses the **Coach** tier, do **not** call `changeCoachSubscription` to a paid Coach price. Instead:

1. Cancel the active Stripe subscription immediately (or at period end, depending on desired policy — default to cancel immediately so the free tier is restored now).
2. Update `coach_profiles` to clear `stripe_subscription_id`, set `subscription_status` to `canceled`, set `subscription_tier` to `coach`, and set `entitlement` back to `promo_free`.
3. Show a clear message: restored to free founding Coach plan.

Add a new server function or branch in `src/lib/coach-checkout.functions.ts` (e.g., `restoreFoundingCoachTier`) and call it from the paywall `handleTierAction` when the coach is founding, currently paid, and selecting Coach.

## Files to modify

- `src/routes/_authenticated/coach.paywall.tsx` — current-plan header, `isCurrentTier` logic, badge rendering, and `handleTierAction` branching.
- `src/lib/coach-checkout.functions.ts` — new `restoreFoundingCoachTier` server function that cancels the active subscription and restores free founding status.

## Acceptance criteria

- A founding coach on Coach Pro sees the header say **Founding Coach Pro** (or similar), and the Coach Pro card is marked **CURRENT**.
- The Coach card is not marked **Active** or **FOUNDING** for that same user.
- A founding coach on Coach Pro can switch to Coach without being billed; the subscription is canceled and the profile returns to `promo_free` / `coach` tier.
- Existing behavior for non-founding coaches and free founding coaches remains unchanged.

No database schema changes required.