## Change

Move the "see other coaches' plans on a shared athlete" feature from **Pro + Club** to **Club only**. Coach Pro users see the same locked state that Coach-tier users currently see.

## Edits

1. **`src/components/coach/athlete-detail-sheet.tsx`** (line 57–58)
   - Change `canViewOtherCoachPlans` from `effectiveTier === "coach_pro" || effectiveTier === "club"` to `effectiveTier === "club"`.

2. **`src/components/coach/also-coached-by-list.tsx`** (line 78)
   - Change the locked-state pill label from `PRO & CLUB` to `CLUB`.

## Out of scope

- No changes to paywall copy, roster caps, messaging, or any other tier-gated feature.
- No DB/server changes — this is a client-side visibility gate; the underlying server function remains callable, matching the existing pattern (the UI never triggers the request when locked).
