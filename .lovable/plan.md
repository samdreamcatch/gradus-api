# Promo carry-through + club invite/removal handling

## 1. Promo code following an invited coach to Stripe

What already works (verified):

- When a parent or adult athlete with a promo on file generates an invite code, the code
  is stored on the invite row with their promo attached.
- When the coach claims that invite (signed in, or right after signing up from
  `/signup/coach?invite=CODE`), the connection is created and the promo is copied onto the
  coach's profile if they don't already have one.

The gap: the paywall/checkout doesn't act on it. `WILSON`, `PRACTICE`, and `WELCOME_BACK`
are all 3-month repeating codes, but the paywall only auto-fills `WELCOME_BACK`, and
checkout only auto-applies a profile promo when it's a *forever* code. So a coach who
arrived through a `WILSON` invite reaches Stripe at full price unless they retype the code.

Two more gaps found:

- A signed-out coach who lands on `/i/CODE` is sent to `/signup/coach?invite=CODE` with no
  `promo` param, so nothing shows on the signup screen — the promo only appears silently
  later. The invite resolver doesn't return the attached promo at all.

### Changes

- `resolveInviteCode` also returns the promo attached to a parent / adult-athlete invite,
  and `/i/$code` passes it through as `?promo=` so the signup screen shows the discount up
  front (it already stashes and applies a `promo` search param).
- Paywall: replace the `WELCOME_BACK`-only auto-apply with a general rule — auto-fill and
  validate whatever active repeating code is on the coach's profile, and show it as applied.
- Checkout: when no code was typed, honor a profile-attached **repeating** code too (not
  only forever codes), still respecting `applies_to_plans` and the card requirement.

## 2. Club invites and removals

### Invite emails

Creating an org coach invite today only stores a row — no email is ever sent.

- New branded email template "Club coach invite" registered alongside the other templates
  (so it's editable in Admin → Emails), with the club name, inviter, and the join link.
- `createOrgCoachInvite` sends it when an email address was entered. Phone-only invites keep
  the copy-the-code behavior.
- New "Resend invite" action on the pending-invite rows in the Organization Admin portal,
  server-side rate-limited to one send per invite per few minutes.

### Removal → 90 days free, WELCOME_BACK pre-applied

Today, both leaving a club and being removed set the coach to `pending`, which drops them
onto the paywall.

- Migration: add `free_access_until timestamptz` to coach profiles (locked to trusted
  writers like the other billing columns).
- On removal and on self-leave: set entitlement to `promo_free`, `free_access_until` to
  90 days out, and keep stamping `promo_code = 'WELCOME_BACK'` (only when the coach has no
  paid subscription and no promo already attached).
- Entitlement checks treat `promo_free` with an expired `free_access_until` as not
  entitled, so the paywall returns after 90 days. Founding coaches (no expiry set) are
  unaffected.
- Settings shows the free window and its end date; the paywall shows the same, with
  `WELCOME_BACK` already applied on Coach Pro — this now falls out of the generalized
  auto-apply in part 1.
- New "Removed from club" email to the coach explaining the 90 days of free access and the
  discount waiting on Coach Pro, sent on admin removal.

## Technical notes

- Files: `src/lib/invite-resolve.functions.ts`, `src/routes/i.$code.tsx`,
  `src/routes/_authenticated/coach.paywall.tsx`, `src/lib/coach-checkout.functions.ts`,
  `src/lib/org-admin.functions.ts`, `src/lib/coach-org.functions.ts`,
  `src/lib/coach-profile.functions.ts`, the Organization Admin coaches/invites route, and
  two new templates in `src/lib/email-templates/` plus `registry.ts`.
- All profile writes stay on the privileged server client, matching the column lockdown.
- No changes to Stripe products, prices, or webhook behavior.

## Verification

- Parent with `WILSON` invites a coach; new coach signs up via the link → connection exists,
  promo shows on signup, and Coach Pro on the paywall shows 3 months free without typing it.
- Club admin invites a coach by email → email arrives with a working join link; resend works.
- Club admin removes a coach → coach gets the email, keeps working access, settings shows the
  90-day free window, and the paywall shows Coach Pro with `WELCOME_BACK` applied.
