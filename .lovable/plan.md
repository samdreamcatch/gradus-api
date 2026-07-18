## Goal

Make `/coach/paywall` the first onboarding step. Coaches choose their path there (Club code, Coach, or Coach Pro — with monthly/annual toggle) *before* they see the profile / sports / levels / hours / invite / review flow. Payment still happens at the paywall step (Stripe checkout for Coach / Coach Pro, code claim for Club, free-forever for founding coaches).

Once a tier is selected, downstream onboarding gates behave correctly (e.g. sport picker cap becomes 1 for Coach, unlimited for Coach Pro / Club) — no more mismatch between the tier and the sports UI.

## Changes

### 1. Redirect unonboarded coaches to `/coach/paywall` first
File: `src/routes/_authenticated/coach.onboarding.tsx`

Add an effect: if `data.profile.onboardedAt` is null AND the coach has no active entitlement path yet (no `organization_id`, no `subscription_tier`, no active founding-coach free grant, `entitlement !== 'paid'` and `entitlement !== 'club_covered'`), `navigate({ to: '/coach/paywall' })`. This is the same gate the paywall already uses in reverse, just applied at onboarding entry.

Result: fresh coaches land on the paywall before they ever see "Step 1 of 6".

### 2. Drop the "path" step from onboarding
Same file.

- Remove `"path"` from `stepOrder` → new order: `["profile", "levels", "hours", "invite", "review"]` (5 steps).
- Remove the `CoachPathChoice` render block and its `canContinue` / `handleContinue` branches.
- Remove `pathValue` state and the `?org=` / `?promo=` seeding that fed it (paywall now owns those inputs — `/coach/paywall?org=...&promo=...` already accepts them via `savePendingPromoCode` + `claimOrganizationInviteCode`).
- Delete the now-unused `CoachPathChoice` import (and the file if nothing else imports it — quick grep first).
- `handleFinish` no longer needs to branch on `pathValue.path`: after `complete.mutateAsync()` succeeds, coaches are already entitled (they came from paywall), so route straight to `/coach/roster`.

### 3. Update paywall so it flows *into* onboarding on success
File: `src/routes/_authenticated/coach.paywall.tsx`

Today the paywall redirects entitled coaches to `/coach/roster`. Change the post-success redirect (Stripe return, club-code claim, founding-coach free path) to:

- If `data.profile.onboardedAt` is null → `navigate({ to: '/coach/onboarding' })`
- Else → `navigate({ to: '/coach/roster' })` (current behavior for returning coaches managing subscriptions)

The existing `useEffect` that watches entitlement transitions after Stripe returns keeps working — it just points to onboarding first when appropriate.

### 4. Make the sports picker cap follow the chosen tier
File: `src/routes/_authenticated/coach.onboarding.tsx`

Right now `SportMultiselect` is passed `maxPrimarySports={1}` unconditionally. Compute it from `effectiveTier` on the profile:

- `coach` → `maxPrimarySports={1}` (plus Strength & Conditioning, already handled in `SportMultiselect`)
- `coach_pro` / `club` → omit the prop (unlimited)

This resolves the concern the user raised: sport selection is only gated *after* the tier is known, and Coach tier's 1-sport cap becomes accurate rather than presumptive.

### 5. Update the paywall preview to match
Nothing to build here — `/dev/paywall-preview` is already the design source and `/coach/paywall` was previously wired to mirror it. Just confirm both still render the same layout after the redirect changes.

## Out of scope

- No pricing changes.
- No changes to Stripe checkout, coupon logic, or the founding-coach free path.
- No changes to the club search / invite lead capture flow.
- Progress bar copy stays "Step N of 5" — paywall is its own screen, not counted as a step.

## Testing

With David Wallace reset (already done):
1. Sign in as David → should land on `/coach/paywall` (not `/coach/onboarding`).
2. Enter code `WILSON` → Coach Pro checkout → complete with test card → returns to `/coach/onboarding` at Step 1 (profile), with sports picker unlimited (Coach Pro tier).
3. Sign in as a fresh coach, pick "Coach" tier ($30/mo) → complete checkout → onboarding sport picker caps at 1 primary + S&C.
4. Sign in as a fresh coach, enter a club code → onboarding starts at profile, unlimited sports, `handleFinish` routes to `/coach/roster`.
