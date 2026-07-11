## Goal
Let an under-18 athlete enter a promo code on the athlete signup screen and have it follow through to their parent's account when the parent signs up — so the influencer attribution lands on the parent (the paying account), even though the kid is the one holding the code.

## Flow

```text
Kid opens /signup/athlete → "No, I'm under 18"
   ├── (optional) enters promo code
   └── taps "Send my parent an invite"
         → share URL becomes  https://gradus.training/signup/parent?promo=<CODE>

Parent taps the link → /signup/parent
   ├── promo field is pre-filled from ?promo=
   └── parent completes signup → code saved to parent_profiles.promo_code
```

No code is required — leaving it blank still works exactly as today.

## Changes

1. **`src/routes/signup.athlete.tsx`** (under-18 "code" stage only)
   - Add a `PromoCodeField` below the invite-code input, labelled "Promo code (optional)".
   - Include the entered promo code as `?promo=<CODE>` in the "Send my parent an invite" share URL and the fallback clipboard text. Only append when non-empty.
   - Also stash it in `sessionStorage` via `savePendingPromoCode` so if the kid ends up completing an athlete flow on the same device (self-managed adult edge case), it still attaches.

2. **`src/routes/signup.parent.tsx`**
   - Extend the route's `validateSearch` to accept an optional `promo` string.
   - Seed the existing `promoCode` state from `Route.useSearch().promo` on mount so the field shows up pre-filled and editable. Everything downstream (validation, `savePendingPromoCode`, post-signup apply) already works.

3. **Under-18 confirm/account sub-flow** (`signup.athlete.confirm.tsx`, `signup.athlete.account.tsx`)
   - No behavior change needed for attribution — the kid's account isn't the paying one. We do NOT attach the promo code to the athlete account in this path; it belongs to the parent.

## Not changing
- Database schema (`promo_codes` table + `parent_profiles.promo_code` already exist).
- Validation rules, admin promo-codes page, stats, or the "we don't recognize that code" inline error behavior.
- Adult (18+) athlete flow — already has its own promo field.

## Edge cases
- Parent already had an account and just uses the kid's invite code: no promo attribution happens (there's no parent signup event). This matches the "attribution at signup" model we picked earlier — call it out to the user only if they want to expand later.
- Invalid promo typed by the kid: same inline "we don't recognize that code" message the parent form uses; still passed through to parent link so parent can correct.
- Kid shares link but parent edits the promo field before submitting: parent's final value wins.
