## What went wrong

From onboarding step 1 (sport picker), the "Choose Coach Pro for more sports →" link goes to `/coach/paywall?tier=coach_pro`. On the paywall, a `useEffect` auto-fires `handleTierAction("coach_pro")` whenever `preselectedTier === "coach_pro"`.

For a coach who already has an active Stripe sub (you), `handleTierAction` calls `switchTier` — which calls `changeCoachSubscription` immediately, with prorated charge, no confirmation. That's why clicking the link inside the sport picker "auto-switched" you to Coach Pro.

For a brand-new coach it would auto-open embedded checkout — also surprising, but at least gated by the Stripe payment step. For an entitled coach, there's no gate at all.

## Fix

1. **Remove the auto-trigger `useEffect` in `src/routes/_authenticated/coach.paywall.tsx`** (the block at lines 243–254 plus its `preselectedActionStartedRef`). Landing on `/coach/paywall?tier=coach_pro` should never execute a subscription change or open checkout on its own.

2. **Keep `?tier=coach_pro` as a visual preselect only**:
   - Scroll/highlight the Coach Pro card (already visually distinguished by `selectedTier`/`preselectedTier` styling — verify it reads `preselectedTier` for the highlight, not just for the auto-action).
   - The coach still has to click the tier's "Upgrade" / "Switch to Coach Pro" button to commit. That path already runs `handleTierAction` → `switchTier` (entitled) or `startCheckout` (new), so no other logic changes.

3. **Undo path for this incident**: no code change needed — the paywall already offers "Switch to Coach" for entitled Pro coaches (calls `changeCoachSubscription`, issues a prorated refund). I'll call that out in the follow-up message so you can revert your account with one click.

## Files touched

- `src/routes/_authenticated/coach.paywall.tsx` — delete the auto-run effect and the `preselectedActionStartedRef` it relies on; leave `preselectedTier` wired to the visual highlight.

No changes to server functions, Stripe, or the onboarding route.
